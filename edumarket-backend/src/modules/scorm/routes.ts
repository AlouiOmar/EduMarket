import crypto from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { DEFAULT_ZIP_LIMITS, ZipError, readZip } from '../../common/zip.js';
import { env } from '../../config/env.js';
import { privateStorage } from '../../integrations/privateStorage.js';
import { AuditEvent } from '../admin/audit.model.js';
import { Course } from '../courses/model.js';
import { canManageCourse } from '../courses/service.js';
import { accessibleItems, countableItems, findItem, plainOutline } from '../courses/structure.js';
import { Enrollment, activeAccess } from '../enrollments/model.js';
import { LessonActivity } from '../enrollments/lesson-activity.model.js';
import { recordSourceGrade } from '../gradebook/service.js';
import { managedCourse, parseId } from '../lms/access.js';
import { CONTENT_TYPES, ScormError, checkFilePolicy, isWritable, outcome, parseManifest, validateCmi, type ScormVersion } from './manifest.js';
import { ScormAttempt, ScormPackage } from './models.js';

/**
 * SCORM 1.2 / 2004. Packages are validated and extracted server-side; their files are only ever served from SCORM_CONTENT_ORIGIN,
 * a separate host without the EduMarket session cookie, with a restrictive CSP (no network access outside that origin) and
 * framing limited to the application. The player page implements the SCORM runtime API and commits whitelisted CMI values.
 */
export const scormRoutes = Router();
export const scormContentRoutes = Router();
const root = () => privateStorage.uploadDirectory('scorm-packages');
const packageDir = (packageId: string) => {
  if (!/^[a-f\d]{24}$/i.test(packageId)) throw new AppError(404, 'NOT_FOUND');
  return path.join(root(), packageId);
};
const runtimeSecret = () => `${env.JWT_SECRET}:scorm-runtime`;
export const scormConfigured = () => !!env.SCORM_CONTENT_ORIGIN;

const uploadDir = privateStorage.uploadDirectory('cloud-staging');
const packageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => { void mkdir(uploadDir, { recursive: true }).then(() => callback(null, uploadDir), error => callback(error as Error, uploadDir)); },
    filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`),
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
}).single('package');

/** Validates and extracts a package; on any error nothing is kept. */
scormRoutes.post('/:courseId/packages', authenticate, allowRoles('teacher', 'institution', 'admin'), rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }), (req: AuthRequest, res, next) => packageUpload(req, res, async error => {
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  let target = '';
  try {
    if (error) throw error instanceof multer.MulterError ? new AppError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'SCORM_PACKAGE_TOO_LARGE' : 'INVALID_UPLOAD') : error;
    const course = await managedCourse(req, req.params.courseId);
    if (!file) throw new AppError(400, 'FILE_REQUIRED');
    let entries;
    try { entries = readZip(await readFile(file.path), { ...DEFAULT_ZIP_LIMITS, maxEntries: 3000, maxTotalBytes: 300 * 1024 * 1024 }); }
    catch (cause) { throw new AppError(422, cause instanceof ZipError ? `SCORM_${cause.code}` : 'SCORM_INVALID_ZIP'); }
    const manifestEntry = entries.find(entry => entry.path === 'imsmanifest.xml');
    if (!manifestEntry) throw new AppError(422, 'SCORM_MANIFEST_MISSING');
    let manifest;
    try { manifest = parseManifest(manifestEntry.data.toString('utf8')); checkFilePolicy(entries.map(entry => entry.path)); }
    catch (cause) { throw new AppError(422, cause instanceof ScormError ? cause.code : 'SCORM_MANIFEST_INVALID'); }
    if (!entries.some(entry => entry.path === manifest.launchPath)) throw new AppError(422, 'SCORM_LAUNCH_MISSING');
    const created = new ScormPackage({ courseId: course._id, title: manifest.title, version: manifest.version, identifier: manifest.identifier, launchPath: manifest.launchPath, fileCount: entries.length, totalSize: entries.reduce((sum, entry) => sum + entry.size, 0), uploadedBy: req.auth!.userId });
    target = packageDir(String(created._id));
    for (const entry of entries) {
      const destination = path.resolve(target, entry.path);
      if (!destination.startsWith(path.resolve(target) + path.sep)) throw new AppError(422, 'SCORM_ZIP_UNSAFE_PATH');
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, entry.data, { flag: 'wx' });
    }
    await created.save();
    target = '';
    await AuditEvent.create({ action: 'scorm.package.imported', actorId: req.auth!.userId, targetType: 'course', targetId: String(course._id), ipAddress: req.ip }).catch(() => undefined);
    res.status(201).json({ success: true, data: { id: String(created._id), title: created.title, version: created.version, launchPath: created.launchPath, fileCount: created.fileCount } });
  } catch (cause) { next(cause); }
  finally {
    if (file) await privateStorage.removeUpload(file.path).catch(() => undefined);
    if (target) await rm(target, { recursive: true, force: true }).catch(() => undefined);
  }
}));

scormRoutes.get('/:courseId/packages', authenticate, allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const packages = await ScormPackage.find({ courseId: course._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: { configured: scormConfigured(), packages: packages.map(row => ({ id: String(row._id), title: row.title, version: row.version, fileCount: row.fileCount, totalSize: row.totalSize, createdAt: (row as any).createdAt })) } });
  } catch (error) { next(error); }
});
scormRoutes.get('/:courseId/packages/:packageId/attempts', authenticate, allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const attempts = await ScormAttempt.find({ courseId: course._id, packageId: parseId(req.params.packageId) }).populate('studentId', 'name').lean();
    res.json({ success: true, data: attempts.map(attempt => ({ studentName: (attempt.studentId as any)?.name || '', completed: attempt.completed, passed: attempt.passed, scorePercent: attempt.scorePercent, sessions: attempt.sessions, lastCommitAt: attempt.lastCommitAt })) });
  } catch (error) { next(error); }
});
/** A package used by an item or with attempts is kept (attempt history). */
scormRoutes.delete('/:courseId/packages/:packageId', authenticate, allowRoles('teacher', 'institution', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const course = await managedCourse(req, req.params.courseId);
    const packageId = parseId(req.params.packageId);
    const full = await Course.findById(course._id).select('chapters').lean();
    if (plainOutline(full?.chapters).some(container => container.lessons.some(item => String(item.scormPackageId) === packageId))) throw new AppError(409, 'SCORM_PACKAGE_IN_USE');
    if (await ScormAttempt.exists({ packageId })) throw new AppError(409, 'SCORM_PACKAGE_IN_USE');
    const deleted = await ScormPackage.deleteOne({ _id: packageId, courseId: course._id });
    if (!deleted.deletedCount) throw new AppError(404, 'SCORM_PACKAGE_NOT_FOUND');
    await rm(packageDir(packageId), { recursive: true, force: true });
    res.json({ success: true, data: { id: packageId } });
  } catch (error) { next(error); }
});

/** Launch: same access rules as any course item. Students get a persistent attempt (resume); managers a preview (not saved). */
scormRoutes.post('/:courseId/items/:itemId/launch', authenticate, async (req: AuthRequest, res, next) => {
  try {
    if (!scormConfigured()) throw new AppError(503, 'SCORM_NOT_CONFIGURED');
    const course = await Course.findById(parseId(req.params.courseId, 'COURSE_NOT_FOUND')).select('chapters teacherId coOwnerIds accessState').lean();
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND');
    const actor = { userId: req.auth!.userId, role: req.auth!.role };
    const manager = await canManageCourse(actor, course.teacherId, course.coOwnerIds);
    let item;
    if (manager) item = findItem(plainOutline(course.chapters), String(req.params.itemId))?.item;
    else {
      const enrollment = actor.role === 'student' ? await Enrollment.findOne(activeAccess({ courseId: course._id, studentId: actor.userId })).select('completedLessonIds').lean() : null;
      if (!enrollment || course.accessState === 'private') throw new AppError(404, 'ITEM_NOT_FOUND');
      item = accessibleItems(plainOutline(course.chapters), { completedIds: enrollment.completedLessonIds }).find(candidate => candidate.id === req.params.itemId);
    }
    if (!item || item.type !== 'scorm') throw new AppError(404, 'ITEM_NOT_FOUND');
    const pkg = await ScormPackage.findOne({ _id: item.scormPackageId, courseId: course._id }).lean();
    if (!pkg) throw new AppError(404, 'SCORM_PACKAGE_NOT_FOUND');
    let attemptId = 'preview';
    if (!manager) {
      const attempt = await ScormAttempt.findOneAndUpdate({ packageId: pkg._id, itemId: item.id, studentId: actor.userId }, { $setOnInsert: { courseId: course._id, cmi: {} }, $inc: { sessions: 1 } }, { upsert: true, new: true }).lean();
      attemptId = String(attempt!._id);
    }
    const token = jwt.sign({ kind: 'scorm', attemptId, packageId: String(pkg._id), courseId: String(course._id), itemId: item.id, userId: actor.userId }, runtimeSecret(), { expiresIn: '4h', audience: 'scorm-content' });
    res.json({ success: true, data: { playerUrl: `${env.SCORM_CONTENT_ORIGIN!.replace(/\/$/, '')}/scorm-content/${token}/`, title: pkg.title, version: pkg.version, preview: manager } });
  } catch (error) { next(error); }
});

// --- Content origin -----------------------------------------------------------------------------------------------------------

interface RuntimeClaims { attemptId: string; packageId: string; courseId: string; itemId: string; userId: string }
/** Content routes answer only on the dedicated host (never on the API host, which carries the session cookie). */
function contentHostOnly(req: Request, _res: Response, next: NextFunction) {
  if (!scormConfigured() || req.headers.host !== new URL(env.SCORM_CONTENT_ORIGIN!).host) return next(new AppError(404, 'NOT_FOUND'));
  next();
}
function claimsOf(token: string): RuntimeClaims {
  try { return jwt.verify(token, runtimeSecret(), { audience: 'scorm-content' }) as RuntimeClaims; } catch { throw new AppError(404, 'NOT_FOUND'); }
}
function isolationHeaders(res: Response, extra: Record<string, string> = {}) {
  res.removeHeader('X-Frame-Options');
  res.set({
    'Content-Security-Policy': [
      "default-src 'self' data: blob:", "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "media-src 'self' data: blob:",
      "font-src 'self' data:", "connect-src 'self'", "frame-src 'self'", "form-action 'self'", "base-uri 'self'", "object-src 'none'", `frame-ancestors 'self' ${new URL(env.APP_ORIGIN).origin}`,
    ].join('; '),
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', ...extra,
  });
}
scormContentRoutes.use(contentHostOnly, rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));

const READ_ONLY = (version: ScormVersion, attemptId: string, entry: string) => version === '1.2'
  ? { 'cmi.core.student_id': attemptId, 'cmi.core.student_name': '', 'cmi.core.entry': entry, 'cmi.core.credit': 'credit', 'cmi.core.lesson_mode': 'normal', 'cmi.launch_data': '', 'cmi.core.total_time': '0000:00:00' }
  : { 'cmi.learner_id': attemptId, 'cmi.learner_name': '', 'cmi.entry': entry, 'cmi.mode': 'normal', 'cmi.credit': 'credit', 'cmi.launch_data': '', 'cmi._version': '1.0' };

/** Player page: SCORM runtime (window.API for 1.2, window.API_1484_11 for 2004) around the package's launch file. */
scormContentRoutes.get('/:token/', async (req, res, next) => {
  try {
    const claims = claimsOf(req.params.token);
    const pkg = await ScormPackage.findById(claims.packageId).lean();
    if (!pkg) throw new AppError(404, 'NOT_FOUND');
    const attempt = claims.attemptId === 'preview' ? null : await ScormAttempt.findById(claims.attemptId).lean();
    const cmi = (attempt?.cmi || {}) as Record<string, string>;
    const resumable = pkg.version === '1.2' ? cmi['cmi.core.exit'] === 'suspend' || !!cmi['cmi.suspend_data'] : cmi['cmi.exit'] === 'suspend' || !!cmi['cmi.suspend_data'];
    const config = {
      version: pkg.version, cmi, readOnly: READ_ONLY(pkg.version as ScormVersion, claims.attemptId === 'preview' ? 'preview' : crypto.createHash('sha256').update(claims.attemptId).digest('hex').slice(0, 16), resumable ? 'resume' : 'ab-initio'),
      writable: [] as string[], appOrigin: new URL(env.APP_ORIGIN).origin, preview: claims.attemptId === 'preview',
    };
    const writable = pkg.version === '1.2'
      ? ['cmi.core.lesson_status', 'cmi.core.score.raw', 'cmi.core.score.min', 'cmi.core.score.max', 'cmi.core.lesson_location', 'cmi.suspend_data', 'cmi.core.session_time', 'cmi.core.exit']
      : ['cmi.completion_status', 'cmi.success_status', 'cmi.score.scaled', 'cmi.score.raw', 'cmi.score.min', 'cmi.score.max', 'cmi.location', 'cmi.suspend_data', 'cmi.session_time', 'cmi.exit', 'cmi.progress_measure'];
    config.writable = writable.filter(key => isWritable(pkg.version as ScormVersion, key));
    const data = JSON.stringify(config).replace(/</g, '\\u003c');
    const launch = pkg.launchPath.split('/').map(encodeURIComponent).join('/');
    isolationHeaders(res, { 'Cache-Control': 'no-store' });
    res.type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${pkg.title.replace(/[<>&"]/g, '')}</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style>
<script type="application/json" id="scorm-data">${data}</script>
<script>(function(){
var cfg=JSON.parse(document.getElementById('scorm-data').textContent),data=cfg.cmi||{},init=false,done=false,err='0',dirty={},v12=cfg.version==='1.2';
var codes=v12?{ok:'0',notInit:'301',notImpl:'401',readOnly:'403',done:'101'}:{ok:'0',notInit:'122',notImpl:'401',readOnly:'404',done:'132'};
function notify(t,ok){try{parent.postMessage({type:t,ok:ok},cfg.appOrigin)}catch(e){}}
function send(final){var body=JSON.stringify({values:dirty,final:!!final});dirty={};
 if(final&&navigator.sendBeacon){navigator.sendBeacon('commit',new Blob([body],{type:'application/json'}));notify('scorm:commit',true);return}
 fetch('commit',{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true}).then(function(r){notify('scorm:commit',r.ok)}).catch(function(){notify('scorm:commit',false)})}
function get(k){if(!init){err=codes.notInit;return ''}err='0';if(k in cfg.readOnly)return String(cfg.readOnly[k]);if(k in data)return String(data[k]);if(cfg.writable.indexOf(k)<0&&!/\\._count$|\\._children$/.test(k)){err=codes.notImpl}return ''}
function set(k,val){if(!init||done){err=done?codes.done:codes.notInit;return 'false'}if(k in cfg.readOnly){err=codes.readOnly;return 'false'}if(cfg.writable.indexOf(k)<0){err=codes.notImpl;return 'false'}data[k]=String(val);dirty[k]=String(val);err='0';return 'true'}
function start(){if(done){err=codes.done;return 'false'}init=true;err='0';return 'true'}
function stop(){if(!init){err=codes.notInit;return 'false'}send(true);done=true;init=false;return 'true'}
function commit(){if(!init){err=codes.notInit;return 'false'}send(false);return 'true'}
var messages={'0':'No error','101':'General exception','122':'Store before init','132':'Terminated','201':'Invalid argument','301':'Not initialized','401':'Not implemented','403':'Read only','404':'Read only'};
window.API={LMSInitialize:start,LMSFinish:stop,LMSGetValue:get,LMSSetValue:set,LMSCommit:commit,LMSGetLastError:function(){return err},LMSGetErrorString:function(c){return messages[c]||''},LMSGetDiagnostic:function(){return ''}};
window.API_1484_11={Initialize:start,Terminate:stop,GetValue:get,SetValue:set,Commit:commit,GetLastError:function(){return err},GetErrorString:function(c){return messages[c]||''},GetDiagnostic:function(){return ''}};
window.addEventListener('pagehide',function(){if(init&&!done){send(true)}});
setInterval(function(){if(init&&!done&&Object.keys(dirty).length)send(false)},30000);
})();</script></head><body><iframe title="${pkg.title.replace(/[<>&"]/g, '')}" src="content/${launch}" allow="fullscreen"></iframe></body></html>`);
  } catch (error) { next(error); }
});

/** Package files (static), read from the extracted directory; paths are confined to the package. */
scormContentRoutes.get(/^\/([^/]+)\/content\/(.+)$/, async (req, res, next) => {
  try {
    const claims = claimsOf((req.params as unknown as string[])[0]);
    const relative = decodeURIComponent((req.params as unknown as string[])[1]);
    const base = path.resolve(packageDir(claims.packageId));
    const file = path.resolve(base, relative);
    if (!file.startsWith(base + path.sep) || relative.includes('\0')) throw new AppError(404, 'NOT_FOUND');
    const extension = path.extname(file).slice(1).toLowerCase();
    if (!CONTENT_TYPES[extension]) throw new AppError(404, 'NOT_FOUND');
    isolationHeaders(res, { 'Cache-Control': 'private, max-age=300', 'Content-Type': CONTENT_TYPES[extension] });
    // `root`: the dot-file rule applies inside the package only (the storage directory itself may contain dots, e.g. `.tmp`).
    res.sendFile(path.relative(base, file), { root: base, dotfiles: 'deny', headers: { 'Content-Type': CONTENT_TYPES[extension] } }, error => { if (error && !res.headersSent) next(new AppError(404, 'NOT_FOUND')); });
  } catch (error) { next(error); }
});

/** Runtime commit: whitelisted CMI values merged into the attempt; completion and score update progress and the gradebook. */
scormContentRoutes.post('/:token/commit', express.json({ limit: '128kb', type: ['application/json', 'text/plain'] }), async (req, res, next) => {
  try {
    const claims = claimsOf(req.params.token);
    const body = z.object({ values: z.record(z.string().max(255), z.unknown()).default({}), final: z.boolean().default(false) }).parse(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
    const pkg = await ScormPackage.findById(claims.packageId).lean();
    if (!pkg) throw new AppError(404, 'NOT_FOUND');
    const { accepted, rejected } = validateCmi(pkg.version as ScormVersion, body.values);
    if (claims.attemptId === 'preview') return res.json({ success: true, data: { preview: true, accepted: Object.keys(accepted), rejected } });
    const attempt = await ScormAttempt.findOne({ _id: claims.attemptId, studentId: claims.userId }).lean();
    if (!attempt) throw new AppError(404, 'NOT_FOUND');
    const cmi = { ...(attempt.cmi as Record<string, string>), ...accepted };
    const result = outcome(pkg.version as ScormVersion, cmi);
    await ScormAttempt.updateOne({ _id: attempt._id }, { $set: { cmi, completed: attempt.completed || result.completed, passed: result.passed, scorePercent: result.percent, lastCommitAt: new Date() } });
    if (result.completed) await recordCompletion(claims, result.percent, pkg.title);
    res.json({ success: true, data: { accepted: Object.keys(accepted), rejected, completed: result.completed } });
  } catch (error) { next(error); }
});

/** Completion of a SCORM item counts as completing the course item; a score goes to the gradebook (out of 100, unpublished). */
async function recordCompletion(claims: RuntimeClaims, percent: number | null, title: string) {
  const enrollment = await Enrollment.findOneAndUpdate(activeAccess({ courseId: claims.courseId, studentId: claims.userId }), { $addToSet: { completedLessonIds: claims.itemId }, $set: { lastAccessedAt: new Date() } }, { new: true });
  if (enrollment) {
    await LessonActivity.updateOne({ studentId: claims.userId, courseId: claims.courseId, lessonId: claims.itemId }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true }).catch(() => undefined);
    const course = await Course.findById(claims.courseId).select('chapters').lean();
    const countable = countableItems(plainOutline(course?.chapters));
    if (!enrollment.completedAt && countable.length && countable.every(item => enrollment.completedLessonIds.includes(item.id))) await Enrollment.updateOne({ _id: enrollment._id }, { $set: { completedAt: new Date() } });
  }
  if (percent !== null) await recordSourceGrade({ courseId: claims.courseId, kind: 'scorm', refId: claims.itemId, studentId: claims.userId, score: Math.round(percent * 100) / 100, status: 'graded', title: `SCORM : ${title}`, maxPoints: 100 });
}
