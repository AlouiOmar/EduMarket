import { Router } from 'express';
import crypto from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { privateStorage } from '../../integrations/privateStorage.js';
import { User } from '../auth/model.js';
import { getSettings } from '../admin/settings.routes.js';
import { subscriptionItem } from '../subscriptions/service.js';
import { Order } from './models.js';
import { orderDto } from './routes.js';
import { OFFLINE_METHODS, cancelOfflineOrder, courseItems, createOfflineOrder, examItem, recordOfflinePayment, type OfflinePaymentInput, type PricedItem } from './service.js';

/** Student side of offline payments (request, cancel, proof download). */
export const offlinePaymentRoutes = Router();
/** Admin side: record a payment on a request, or register a payment taken at the desk. */
export const adminOfflinePaymentRoutes = Router();

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const proofRoot = privateStorage.uploadDirectory('payment-proofs');
const PROOF_TYPES: Record<string, 'pdf' | 'png' | 'jpg'> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };

const receiveProof = (req: AuthRequest, res: any, next: (error?: unknown) => void) => multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => { void mkdir(proofRoot, { recursive: true }).then(() => callback(null, proofRoot), error => callback(error as Error, proofRoot)); },
    filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, fieldSize: 20_000 },
  fileFilter: (_req, file, callback) => PROOF_TYPES[file.mimetype] ? callback(null, true) : callback(new AppError(415, 'UNSUPPORTED_PAYMENT_PROOF_TYPE')),
}).single('proof')(req, res, error => {
  if (!error) return next();
  if (error instanceof multer.MulterError) return next(new AppError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'PAYMENT_PROOF_TOO_LARGE' : 'INVALID_PAYMENT_PROOF_UPLOAD'));
  next(error instanceof AppError ? error : new AppError(400, 'INVALID_PAYMENT_PROOF_UPLOAD'));
});

/** Checks the file signature, then moves the upload into private storage. Returns the proof metadata. */
async function storeProof(file: Express.Multer.File | undefined) {
  if (!file) return undefined;
  const extension = PROOF_TYPES[file.mimetype];
  const head = await privateStorage.readUploadPrefix(file.path, 8);
  const valid = extension === 'pdf' ? head.toString('ascii', 0, 5) === '%PDF-'
    : extension === 'png' ? head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (!valid) throw new AppError(415, 'INVALID_PAYMENT_PROOF_CONTENT');
  const storageKey = `${path.basename(file.filename, '.upload')}.${extension}`;
  await privateStorage.storeUpload('payment-proofs', storageKey, file.path);
  const originalName = path.basename(file.originalname).replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 180) || `proof.${extension}`;
  return { storageKey, originalName, mimeType: file.mimetype, size: file.size };
}

// Multipart forms carry the JSON payload in a single `payload` field next to the optional `proof` file.
const payloadOf = (req: AuthRequest) => {
  const raw = typeof req.body?.payload === 'string' ? req.body.payload : '{}';
  try { return JSON.parse(raw); } catch { throw new AppError(400, 'MALFORMED_JSON'); }
};
const paymentSchema = z.object({
  method: z.enum(OFFLINE_METHODS), reference: z.string().trim().max(120).default(''), bankName: z.string().trim().max(120).default(''),
  payerName: z.string().trim().max(120).default(''), receivedAt: z.string().datetime({ offset: true }).optional(), note: z.string().trim().max(1000).default(''),
}).superRefine((value, ctx) => {
  // A cheque or a transfer is traced by its number; cash only needs the receipt.
  if (value.method !== 'cash' && !value.reference) ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Reference required' });
});
const toInput = (payment: z.infer<typeof paymentSchema>, proof: OfflinePaymentInput['proof']): OfflinePaymentInput => ({
  ...payment, receivedAt: payment.receivedAt ? new Date(payment.receivedAt) : undefined, proof,
});
const populated = (orderId: unknown) => Order.findById(orderId).populate('studentId', 'name email').populate('items.sellerId', 'name').populate('offlinePayment.recordedBy', 'name').lean();

async function assertOfflineEnabled() {
  if (!(await getSettings()).offlinePayments.enabled) throw new AppError(409, 'OFFLINE_PAYMENTS_DISABLED');
}

// ---------------------------------------------------------------- student

offlinePaymentRoutes.use(authenticate);

/** A student asks to pay paid courses or a subscription offline; access is granted once an admin records the payment. */
offlinePaymentRoutes.post('/offline-requests', allowRoles('student'), async (req: AuthRequest, res, next) => {
  try {
    await assertOfflineEnabled();
    const input = z.object({ courseIds: z.array(objectId).max(20).default([]), plan: z.enum(['monthly', 'yearly']).optional(), method: z.enum(OFFLINE_METHODS).default('cash') })
      .strict().refine(value => value.courseIds.length > 0 || !!value.plan, 'Nothing to pay').parse(req.body);
    if (await Order.countDocuments({ studentId: req.auth!.userId, provider: 'offline', status: 'pending' }) >= 5) throw new AppError(409, 'TOO_MANY_OFFLINE_REQUESTS');
    const items: PricedItem[] = [...(input.courseIds.length ? await courseItems(req.auth!.userId, input.courseIds) : []), ...(input.plan ? [await subscriptionItem(input.plan)] : [])];
    const order = await createOfflineOrder(req.auth!.userId, items, input.method);
    res.status(201).json({ success: true, data: { order: orderDto(order), instructions: (await getSettings()).offlinePayments.instructions } });
  } catch (error) { next(error); }
});

offlinePaymentRoutes.post('/orders/:orderId/cancel', allowRoles('student'), async (req: AuthRequest, res, next) => {
  try {
    const orderId = objectId.safeParse(req.params.orderId); if (!orderId.success) throw new AppError(404, 'ORDER_NOT_FOUND');
    res.json({ success: true, data: orderDto(await cancelOfflineOrder(orderId.data, req.auth!.userId)) });
  } catch (error) { next(error); }
});

/** Proof scan: visible to the buyer and to admins only. */
offlinePaymentRoutes.get('/orders/:orderId/offline-proof', allowRoles('student', 'admin'), async (req: AuthRequest, res, next) => {
  try {
    const orderId = objectId.safeParse(req.params.orderId); if (!orderId.success) throw new AppError(404, 'PAYMENT_PROOF_NOT_FOUND');
    const order = await Order.findById(orderId.data).select('studentId offlinePayment.proof').lean();
    const proof = order?.offlinePayment?.proof;
    if (!order || !proof?.storageKey || (req.auth!.role !== 'admin' && String(order.studentId) !== req.auth!.userId)) throw new AppError(404, 'PAYMENT_PROOF_NOT_FOUND');
    privateStorage.send('payment-proofs', proof.storageKey, res, { mimeType: proof.mimeType!, downloadName: proof.originalName || 'proof', headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } },
      error => { if (error && !res.headersSent) next(new AppError(404, 'PAYMENT_PROOF_NOT_FOUND')); });
  } catch (error) { next(error); }
});

// ---------------------------------------------------------------- admin

adminOfflinePaymentRoutes.use(authenticate, allowRoles('admin'));

/** Settles an open offline request: method, reference (cheque/transfer number), date and optional scan. */
adminOfflinePaymentRoutes.post('/orders/:orderId/offline-payment', receiveProof, async (req: AuthRequest, res, next) => {
  let proof: OfflinePaymentInput['proof'];
  try {
    const orderId = objectId.safeParse(req.params.orderId); if (!orderId.success) throw new AppError(404, 'ORDER_NOT_FOUND');
    const payment = paymentSchema.parse(payloadOf(req));
    proof = await storeProof(req.file);
    const order = await recordOfflinePayment(orderId.data, toInput(payment, proof), { userId: req.auth!.userId, ip: req.ip });
    res.json({ success: true, data: orderDto(await populated(order._id), 'admin') });
  } catch (error) {
    if (proof) await privateStorage.remove('payment-proofs', proof.storageKey).catch(() => undefined);
    next(error);
  } finally { if (req.file) await privateStorage.removeUpload(req.file.path).catch(() => undefined); }
});

/** Registers a payment taken at the desk for a student: the order is created and paid in one step. */
adminOfflinePaymentRoutes.post('/offline', receiveProof, async (req: AuthRequest, res, next) => {
  let proof: OfflinePaymentInput['proof'];
  let orderId: unknown;
  try {
    const raw = payloadOf(req);
    const payment = paymentSchema.parse(raw.payment || {});
    const target = z.object({
      studentEmail: z.string().trim().toLowerCase().email().max(254), courseIds: z.array(objectId).max(20).default([]),
      examIds: z.array(objectId).max(5).default([]), plan: z.enum(['monthly', 'yearly']).optional(),
    }).strict().refine(value => value.courseIds.length + value.examIds.length > 0 || !!value.plan, 'Nothing to pay').parse(raw.target || {});
    const student = await User.findOne({ email: target.studentEmail, role: 'student' }).select('_id').lean();
    if (!student) throw new AppError(404, 'STUDENT_NOT_FOUND');
    const studentId = String(student._id);
    const items: PricedItem[] = [
      ...(target.courseIds.length ? await courseItems(studentId, target.courseIds) : []),
      ...await Promise.all(target.examIds.map(examId => examItem(studentId, examId))),
      ...(target.plan ? [await subscriptionItem(target.plan)] : []),
    ];
    proof = await storeProof(req.file);
    const created = await createOfflineOrder(studentId, items, payment.method);
    orderId = created._id;
    const order = await recordOfflinePayment(String(created._id), toInput(payment, proof), { userId: req.auth!.userId, ip: req.ip });
    res.status(201).json({ success: true, data: orderDto(await populated(order._id), 'admin') });
  } catch (error) {
    // Never leave a half-registered desk payment behind: the created order is closed and the scan removed.
    if (orderId) await Order.updateOne({ _id: orderId, status: 'pending' }, { $set: { status: 'failed', failureReason: 'OFFLINE_RECORDING_FAILED' } }).catch(() => undefined);
    if (proof) await privateStorage.remove('payment-proofs', proof.storageKey).catch(() => undefined);
    next(error);
  } finally { if (req.file) await privateStorage.removeUpload(req.file.path).catch(() => undefined); }
});

adminOfflinePaymentRoutes.post('/orders/:orderId/cancel', async (req: AuthRequest, res, next) => {
  try {
    const orderId = objectId.safeParse(req.params.orderId); if (!orderId.success) throw new AppError(404, 'ORDER_NOT_FOUND');
    const order = await cancelOfflineOrder(orderId.data);
    res.json({ success: true, data: orderDto(await populated(order._id), 'admin') });
  } catch (error) { next(error); }
});
