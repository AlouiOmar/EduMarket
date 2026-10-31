import crypto from 'node:crypto';
import express, { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { AuditEvent } from '../admin/audit.model.js';
import { User } from '../auth/model.js';
import { Course } from '../courses/model.js';
import { canManageCourse } from '../courses/service.js';
import { accessibleItems, findItem, plainOutline } from '../courses/structure.js';
import { Enrollment, activeAccess } from '../enrollments/model.js';
import { recordSourceGrade } from '../gradebook/service.js';
import { issuer, ltiConfigured, ltiSubject, platformJwks, signIdToken, verifyClientAssertion } from './keys.js';
import { LtiAccessToken, LtiLaunch, LtiReplay, LtiTool } from './models.js';

/**
 * LTI 1.3 platform endpoints. Flow: the user opens `/launch/:courseId/:itemId` (access to the item checked like any content) →
 * redirect to the tool's OIDC login with a single-use login hint → the tool calls `/authorize` from the same browser → every
 * parameter is checked (client id, registered redirect URI, response type/mode, scope, nonce, unexpired and unused hint, same
 * user) → an RS256 `id_token` (5 minutes) is posted to the redirect URI. A simple external link is never treated as LTI.
 */
export const ltiRoutes = Router();
const SCORE_SCOPE = 'https://purl.imsglobal.org/spec/lti-ags/scope/score';
const httpsUrl = z.string().trim().url().max(2000).refine(value => /^https?:\/\//i.test(value), 'HTTP_URL_REQUIRED');
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Auto-submitted form (OIDC form_post response mode). The page itself runs no script from the tool. */
function postForm(res: Response, action: string, fields: Record<string, string>) {
  const inputs = Object.entries(fields).map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join('');
  const nonce = crypto.randomBytes(16).toString('base64');
  res.set({ 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${new URL(action).origin}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    .type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>LTI</title></head><body><form id="lti" method="post" action="${escapeHtml(action)}">${inputs}<noscript><button type="submit">Continue</button></noscript></form><script nonce="${nonce}">document.getElementById('lti').submit();</script></body></html>`);
}

ltiRoutes.get('/jwks', (_req, res, next) => {
  try { res.set('Cache-Control', 'public, max-age=300').json(platformJwks()); } catch (error) { next(error); }
});
ltiRoutes.get('/status', (_req, res) => { res.json({ success: true, data: { configured: ltiConfigured(), issuer: ltiConfigured() ? issuer() : null } }); });

// --- Administration -------------------------------------------------------------------------------------------------------

const toolSchema = z.object({
  name: z.string().trim().min(1).max(120), oidcLoginUrl: httpsUrl, targetLinkUri: httpsUrl, redirectUris: z.array(httpsUrl).min(1).max(10),
  jwksUrl: z.union([z.literal(''), httpsUrl]).default(''), publicKeyPem: z.string().trim().max(10000).default(''),
  privacy: z.object({ sendName: z.boolean().default(false), sendEmail: z.boolean().default(false) }).default({}), status: z.enum(['active', 'disabled']).default('active'),
}).strict().refine(value => !!value.jwksUrl || !!value.publicKeyPem, 'LTI_TOOL_KEY_REQUIRED').refine(value => {
  if (!value.publicKeyPem) return true;
  try { crypto.createPublicKey(value.publicKeyPem); return true; } catch { return false; }
}, 'INVALID_PUBLIC_KEY');
const toolDto = (tool: any) => ({ id: String(tool._id), name: tool.name, clientId: tool.clientId, deploymentId: tool.deploymentId, oidcLoginUrl: tool.oidcLoginUrl, targetLinkUri: tool.targetLinkUri, redirectUris: tool.redirectUris, jwksUrl: tool.jwksUrl, hasPublicKey: !!tool.publicKeyPem, privacy: tool.privacy, status: tool.status });

ltiRoutes.get('/tools', authenticate, allowRoles('admin'), async (_req, res, next) => {
  try { res.json({ success: true, data: { configured: ltiConfigured(), issuer: ltiConfigured() ? issuer() : null, tools: (await LtiTool.find().sort({ createdAt: 1 }).lean()).map(toolDto) } }); } catch (error) { next(error); }
});
ltiRoutes.post('/tools', authenticate, allowRoles('admin'), async (req: AuthRequest, res, next) => {
  try {
    const tool = await LtiTool.create({ ...toolSchema.parse(req.body), clientId: crypto.randomUUID(), deploymentId: crypto.randomUUID(), createdBy: req.auth!.userId });
    await AuditEvent.create({ action: 'lti.tool.registered', actorId: req.auth!.userId, targetType: 'system', targetId: String(tool._id), ipAddress: req.ip }).catch(() => undefined);
    res.status(201).json({ success: true, data: toolDto(tool) });
  } catch (error) { next(error); }
});
ltiRoutes.patch('/tools/:toolId', authenticate, allowRoles('admin'), async (req: AuthRequest, res, next) => {
  try {
    const input = toolSchema.innerType().innerType().partial().strict().parse(req.body);
    const tool = await LtiTool.findByIdAndUpdate(z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.toolId), { $set: input }, { new: true }).lean();
    if (!tool) throw new AppError(404, 'LTI_TOOL_NOT_FOUND');
    res.json({ success: true, data: toolDto(tool) });
  } catch (error) { next(error); }
});
/** Active tools a teacher can place in a course (name only: secrets and keys are admin-only). */
ltiRoutes.get('/tools/available', authenticate, allowRoles('teacher', 'institution', 'admin'), async (_req, res, next) => {
  try { res.json({ success: true, data: { configured: ltiConfigured(), tools: (await LtiTool.find({ status: 'active' }).select('name').lean()).map(tool => ({ id: String(tool._id), name: tool.name })) } }); } catch (error) { next(error); }
});

// --- Launch -----------------------------------------------------------------------------------------------------------------

ltiRoutes.get('/launch/:courseId/:itemId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    if (!ltiConfigured()) throw new AppError(503, 'LTI_NOT_CONFIGURED');
    const course = await Course.findById(z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.courseId)).select('title chapters teacherId coOwnerIds accessState').lean();
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
    const actor = { userId: req.auth!.userId, role: req.auth!.role };
    const manager = await canManageCourse(actor, course.teacherId, course.coOwnerIds);
    let item;
    if (manager) item = findItem(plainOutline(course.chapters), String(req.params.itemId))?.item;
    else {
      // Students: exactly the content visibility rules (hidden, scheduled, sequential, private course → not found).
      const enrollment = await Enrollment.findOne(activeAccess({ courseId: course._id, studentId: actor.userId })).select('completedLessonIds').lean();
      if (!enrollment || course.accessState === 'private' || actor.role !== 'student') throw new AppError(404, 'ITEM_NOT_FOUND');
      item = accessibleItems(plainOutline(course.chapters), { completedIds: enrollment.completedLessonIds }).find(candidate => candidate.id === req.params.itemId);
    }
    if (!item || item.type !== 'lti' || !item.ltiToolId) throw new AppError(404, 'ITEM_NOT_FOUND');
    const tool = await LtiTool.findOne({ _id: item.ltiToolId, status: 'active' }).lean();
    if (!tool) throw new AppError(404, 'LTI_TOOL_NOT_FOUND');
    const launch = await LtiLaunch.create({ toolId: tool._id, userId: actor.userId, courseId: course._id, itemId: item.id, role: manager ? 'instructor' : 'learner', loginHint: crypto.randomBytes(24).toString('base64url'), expiresAt: new Date(Date.now() + 5 * 60_000) });
    const url = new URL(tool.oidcLoginUrl);
    for (const [key, value] of Object.entries({ iss: issuer(), login_hint: launch.loginHint, lti_message_hint: launch.loginHint, target_link_uri: tool.targetLinkUri, client_id: tool.clientId, lti_deployment_id: tool.deploymentId })) url.searchParams.set(key, value);
    res.set('Cache-Control', 'no-store').redirect(302, url.toString());
  } catch (error) { next(error); }
});

const authorizeSchema = z.object({
  scope: z.string(), response_type: z.string(), response_mode: z.string(), client_id: z.string().min(1).max(200), redirect_uri: z.string().min(1).max(2000),
  login_hint: z.string().min(1).max(200), state: z.string().min(1).max(2000), nonce: z.string().min(1).max(500), prompt: z.string().optional(), lti_message_hint: z.string().max(200).optional(),
}).passthrough();

/** OIDC authentication request from the tool (GET or POST). Any invalid parameter refuses the launch; nothing is posted back. */
async function authorize(req: AuthRequest, res: Response, next: (error?: unknown) => void) {
  try {
    if (!ltiConfigured()) throw new AppError(503, 'LTI_NOT_CONFIGURED');
    const parsed = authorizeSchema.safeParse({ ...req.query, ...(typeof req.body === 'object' ? req.body : {}) });
    if (!parsed.success) throw new AppError(400, 'LTI_INVALID_REQUEST');
    const input = parsed.data;
    if (!input.scope.split(' ').includes('openid') || input.response_type !== 'id_token' || input.response_mode !== 'form_post' || (input.prompt && input.prompt !== 'none')) throw new AppError(400, 'LTI_INVALID_REQUEST');
    const tool = await LtiTool.findOne({ clientId: input.client_id, status: 'active' }).lean();
    if (!tool) throw new AppError(400, 'LTI_INVALID_CLIENT');
    // Exact match only (no prefix or wildcard): the id_token can only be posted to an address the administrator registered.
    if (!tool.redirectUris.includes(input.redirect_uri)) throw new AppError(400, 'LTI_INVALID_REDIRECT_URI');
    if (input.lti_message_hint && input.lti_message_hint !== input.login_hint) throw new AppError(400, 'LTI_INVALID_REQUEST');
    const launch = await LtiLaunch.findOneAndUpdate({ loginHint: input.login_hint, toolId: tool._id, usedAt: null, expiresAt: { $gt: new Date() } }, { $set: { usedAt: new Date() } }, { new: true }).lean();
    if (!launch) throw new AppError(400, 'LTI_LOGIN_EXPIRED');
    if (String(launch.userId) !== req.auth!.userId) throw new AppError(403, 'LTI_USER_MISMATCH');
    const [course, user] = await Promise.all([Course.findById(launch.courseId).select('title chapters').lean(), User.findById(launch.userId).select('name email').lean()]);
    const item = course ? findItem(plainOutline(course.chapters), launch.itemId)?.item : undefined;
    if (!course || !item || !user) throw new AppError(404, 'ITEM_NOT_FOUND');
    const lineitem = `${issuer()}/api/v1/lti/ags/${course._id}/${item.id}`;
    const claims: Record<string, unknown> = {
      iss: issuer(), aud: tool.clientId, azp: tool.clientId, sub: ltiSubject(String(tool._id), String(user._id)), nonce: input.nonce,
      'https://purl.imsglobal.org/spec/lti/claim/message_type': 'LtiResourceLinkRequest',
      'https://purl.imsglobal.org/spec/lti/claim/version': '1.3.0',
      'https://purl.imsglobal.org/spec/lti/claim/deployment_id': tool.deploymentId,
      'https://purl.imsglobal.org/spec/lti/claim/target_link_uri': tool.targetLinkUri,
      'https://purl.imsglobal.org/spec/lti/claim/resource_link': { id: item.id, title: item.title },
      'https://purl.imsglobal.org/spec/lti/claim/context': { id: String(course._id), title: course.title, type: ['http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering'] },
      'https://purl.imsglobal.org/spec/lti/claim/roles': [launch.role === 'instructor' ? 'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor' : 'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
      'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint': { scope: [SCORE_SCOPE], lineitem },
      ...(tool.privacy?.sendName ? { name: user.name } : {}),
      ...(tool.privacy?.sendEmail ? { email: user.email } : {}),
    };
    await AuditEvent.create({ action: 'lti.launch', actorId: req.auth!.userId, targetType: 'course', targetId: String(course._id), ipAddress: req.ip }).catch(() => undefined);
    postForm(res, input.redirect_uri, { id_token: signIdToken(claims), state: input.state });
  } catch (error) { next(error); }
}
const formBody = express.urlencoded({ extended: false, limit: '16kb' });
ltiRoutes.get('/authorize', authenticate, authorize);
ltiRoutes.post('/authorize', formBody, authenticate, authorize);

// --- Services (OAuth 2 client credentials + AGS scores) ----------------------------------------------------------------------

ltiRoutes.post('/token', formBody, async (req, res, next) => {
  try {
    if (!ltiConfigured()) throw new AppError(503, 'LTI_NOT_CONFIGURED');
    const input = z.object({ grant_type: z.literal('client_credentials'), client_assertion_type: z.literal('urn:ietf:params:oauth:client-assertion-type:jwt-bearer'), client_assertion: z.string().min(20).max(10000), scope: z.string().max(2000).default('') }).passthrough().safeParse(req.body);
    if (!input.success) throw new AppError(400, 'LTI_INVALID_REQUEST');
    const unverified = JSON.parse(Buffer.from(input.data.client_assertion.split('.')[1] || '', 'base64url').toString() || '{}') as { iss?: string };
    const tool = typeof unverified.iss === 'string' ? await LtiTool.findOne({ clientId: unverified.iss, status: 'active' }).lean() : null;
    if (!tool) throw new AppError(401, 'LTI_INVALID_CLIENT');
    const payload = await verifyClientAssertion(input.data.client_assertion, tool);
    try { await LtiReplay.create({ toolId: tool._id, jti: String(payload.jti), expiresAt: new Date((payload.exp! + 60) * 1000) }); }
    catch (error) { if ((error as { code?: number }).code === 11000) throw new AppError(401, 'LTI_ASSERTION_REPLAYED'); throw error; }
    const scopes = input.data.scope.split(' ').filter(scope => scope === SCORE_SCOPE);
    if (!scopes.length) throw new AppError(400, 'LTI_INVALID_SCOPE');
    const token = crypto.randomBytes(32).toString('base64url');
    await LtiAccessToken.create({ tokenHash: crypto.createHash('sha256').update(token).digest('hex'), toolId: tool._id, scopes, expiresAt: new Date(Date.now() + 3600_000) });
    res.set('Cache-Control', 'no-store').json({ access_token: token, token_type: 'Bearer', expires_in: 3600, scope: scopes.join(' ') });
  } catch (error) { next(error); }
});

/** AGS score publication (only "FullyGraded" scores are recorded, in the gradebook, unpublished by default). */
ltiRoutes.post('/ags/:courseId/:itemId/scores', express.json({ type: ['application/json', 'application/vnd.ims.lis.v1.score+json'], limit: '16kb' }), async (req, res, next) => {
  try {
    const token = req.header('authorization')?.replace(/^Bearer\s+/i, '') || '';
    const access = token ? await LtiAccessToken.findOne({ tokenHash: crypto.createHash('sha256').update(token).digest('hex'), expiresAt: { $gt: new Date() }, scopes: SCORE_SCOPE }).lean() : null;
    if (!access) throw new AppError(401, 'LTI_INVALID_TOKEN');
    const score = z.object({ userId: z.string().min(1).max(100), scoreGiven: z.number().min(0).optional(), scoreMaximum: z.number().positive().optional(), activityProgress: z.string(), gradingProgress: z.string(), timestamp: z.string() }).passthrough().parse(req.body);
    const course = await Course.findById(z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.courseId)).select('chapters').lean();
    const item = course ? findItem(plainOutline(course.chapters), req.params.itemId)?.item : undefined;
    if (!course || !item || item.type !== 'lti' || String(item.ltiToolId) !== String(access.toolId)) throw new AppError(404, 'LTI_LINEITEM_NOT_FOUND');
    const studentIds = await Enrollment.find({ courseId: course._id }).distinct('studentId');
    const studentId = studentIds.find(id => ltiSubject(String(access.toolId), String(id)) === score.userId);
    if (!studentId) throw new AppError(404, 'LTI_USER_NOT_FOUND');
    if (score.gradingProgress === 'FullyGraded' && score.scoreGiven !== undefined && score.scoreMaximum) {
      if (score.scoreGiven > score.scoreMaximum) throw new AppError(400, 'SCORE_EXCEEDS_MAXIMUM');
      await recordSourceGrade({ courseId: course._id, kind: 'lti', refId: item.id, studentId, score: score.scoreGiven, status: 'graded', title: `LTI : ${item.title}`, maxPoints: score.scoreMaximum });
    }
    res.status(204).end();
  } catch (error) { next(error); }
});
