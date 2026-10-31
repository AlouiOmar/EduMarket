import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import multer from 'multer';
import path from 'node:path';
import { rateLimit } from 'express-rate-limit';
import { authenticate, allowRoles, type AuthRequest } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { User } from '../auth/model.js';
import { createNotification } from '../notifications/service.js';
import { Conversation, Message } from './models.js';
import { Enrollment } from '../enrollments/model.js';
import { Course } from '../courses/model.js';
import { privateStorage } from '../../integrations/privateStorage.js';
import { publishMessageEvent, subscribeUserEvents } from '../../integrations/userEvents.js';

export const messagingRoutes = Router();
messagingRoutes.use(authenticate, allowRoles('student', 'teacher'));
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const isParticipant = (conversation: { participants: unknown[] }, userId: string) => conversation.participants.some(id => String((id as { _id?: unknown })._id || id) === userId);
const contactLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
const sendLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
const attachmentUploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const storageRoot = privateStorage.uploadDirectory('message-attachments');
const messageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => { void mkdir(storageRoot, { recursive: true }).then(() => callback(null, storageRoot), error => callback(error as Error, storageRoot)); },
    filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, parts: 2 },
  fileFilter: (_req, file, callback) => {
    const accepted = ['application/pdf', 'application/zip', 'application/x-zip-compressed', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!accepted.includes(file.mimetype)) return callback(new AppError(415, 'UNSUPPORTED_MESSAGE_ATTACHMENT_TYPE'));
    callback(null, true);
  },
}).single('file');
const voiceUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => { void mkdir(storageRoot, { recursive: true }).then(() => callback(null, storageRoot), error => callback(error as Error, storageRoot)); },
    filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, parts: 2 },
  fileFilter: (_req, file, callback) => {
    if (!['audio/webm', 'audio/ogg', 'audio/mp4'].includes(file.mimetype.split(';')[0])) return callback(new AppError(415, 'UNSUPPORTED_VOICE_NOTE_TYPE'));
    callback(null, true);
  },
}).single('voice');
const receiveMessageAttachment = (req: AuthRequest, res: any, next: (error?: unknown) => void) => messageUpload(req, res, error => {
  if (!error) return next();
  if (error instanceof multer.MulterError) return next(new AppError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'MESSAGE_ATTACHMENT_TOO_LARGE' : 'INVALID_MESSAGE_ATTACHMENT'));
  next(error instanceof AppError ? error : new AppError(400, 'INVALID_MESSAGE_ATTACHMENT'));
});
const receiveMessageVoice = (req: AuthRequest, res: any, next: (error?: unknown) => void) => voiceUpload(req, res, error => {
  if (!error) return next();
  if (error instanceof multer.MulterError) return next(new AppError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'VOICE_NOTE_TOO_LARGE' : 'INVALID_VOICE_NOTE'));
  next(error instanceof AppError ? error : new AppError(400, 'INVALID_VOICE_NOTE'));
});
const requireConversationParticipant = (req: AuthRequest, _res: any, next: (error?: unknown) => void) => {
  const parsedId = objectId.safeParse(req.params.conversationId);
  if (!parsedId.success) return next(new AppError(404, 'CONVERSATION_NOT_FOUND'));
  void Conversation.findById(parsedId.data).select('participants').lean().then(conversation => {
    if (!conversation || !isParticipant(conversation, req.auth!.userId)) return next(new AppError(404, 'CONVERSATION_NOT_FOUND'));
    next();
  }).catch(next);
};
const limitAttachmentUploads = (req: AuthRequest, res: any, next: (error?: unknown) => void) => req.is('multipart/form-data') ? attachmentUploadLimiter(req, res, next) : next();
const messageDto = (row: any) => row.hiddenAt ? ({
  id: String(row._id), conversationId: String(row.conversationId), senderId: String(row.senderId), text: '', timestamp: row.createdAt, read: true, hidden: true,
}) : ({
  id: String(row._id), conversationId: String(row.conversationId), senderId: String(row.senderId), text: row.text || '', timestamp: row.createdAt,
  read: (row.readBy || []).some((user: unknown) => String(user) !== String(row.senderId)),
  ...(row.attachment?.storageKey && row.attachment.kind === 'voice'
    ? { voiceUrl: `/messaging/voice-notes/${row.attachment._id}`, voiceDurationSeconds: row.attachment.durationSeconds }
    : row.attachment?.storageKey ? { attachment: { name: row.attachment.name, size: `${(row.attachment.size / (1024 * 1024)).toFixed(1)} MB`, url: `/messaging/attachments/${row.attachment._id}` } } : {}),
});

messagingRoutes.get('/events', (req: AuthRequest, res) => {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  subscribeUserEvents(req.auth!.userId, res);
});

messagingRoutes.get('/contacts', contactLimiter, async (req: AuthRequest, res, next) => {
  try {
    const email = z.string().trim().email().max(254).parse(req.query.email).toLowerCase();
    const targetRole = req.auth!.role === 'student' ? 'teacher' : 'student';
    const user = await User.findOne({ email, role: targetRole, status: 'active', ...(targetRole === 'teacher' ? { verified: true } : {}) }).select('name role headline').lean();
    if (!user) throw new AppError(404, 'CONTACT_NOT_FOUND');
    if (req.auth!.role === 'teacher') {
      const courseIds = await Course.find({ teacherId: req.auth!.userId, status: 'published' }).distinct('_id');
      if (!await Enrollment.exists({ studentId: user._id, courseId: { $in: courseIds } })) throw new AppError(404, 'CONTACT_NOT_FOUND');
    }
    res.json({ success: true, data: { id: String(user._id), name: user.name, role: user.role, headline: user.headline || '' } });
  } catch (error) { next(error); }
});

messagingRoutes.get('/conversations', async (req: AuthRequest, res, next) => {
  try {
    const rows = await Conversation.find({ participants: req.auth!.userId }).sort({ lastMessageAt: -1 }).populate('participants', 'name role headline').lean();
    const result = await Promise.all(rows.map(async row => ({
      id: String(row._id), participants: row.participants,
      lastMessage: row.lastMessageText ? { text: row.lastMessageText, timestamp: row.lastMessageAt } : null,
      unreadCount: await Message.countDocuments({ conversationId: row._id, senderId: { $ne: req.auth!.userId }, readBy: { $ne: req.auth!.userId } }), updatedAt: row.lastMessageAt,
    })));
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

messagingRoutes.post('/conversations', contactLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { email } = z.object({ email: z.string().trim().email().max(254) }).strict().parse(req.body);
    const targetRole = req.auth!.role === 'student' ? 'teacher' : 'student';
    const target = await User.findOne({ email: email.toLowerCase(), role: targetRole, status: 'active', ...(targetRole === 'teacher' ? { verified: true } : {}) }).select('_id name role headline');
    if (!target) throw new AppError(404, 'CONTACT_NOT_FOUND');
    if (req.auth!.role === 'teacher') {
      const courseIds = await Course.find({ teacherId: req.auth!.userId, status: 'published' }).distinct('_id');
      if (!await Enrollment.exists({ studentId: target._id, courseId: { $in: courseIds } })) throw new AppError(404, 'CONTACT_NOT_FOUND');
    }
    const ids = [req.auth!.userId, String(target._id)].sort();
    const participantKey = ids.join(':');
    let conversation = await Conversation.findOne({ participantKey });
    if (!conversation) {
      try { conversation = await Conversation.create({ participants: ids, participantKey }); }
      catch (error) { if ((error as { code?: number }).code !== 11000) throw error; conversation = await Conversation.findOne({ participantKey }); }
    }
    res.status(201).json({ success: true, data: { id: String(conversation!._id), participants: await User.find({ _id: { $in: ids } }).select('name role headline').lean(), lastMessage: null, unreadCount: 0, updatedAt: conversation!.lastMessageAt } });
  } catch (error) { next(error); }
});

messagingRoutes.get('/conversations/:conversationId/messages', async (req: AuthRequest, res, next) => {
  try {
    const id = objectId.safeParse(req.params.conversationId); if (!id.success) throw new AppError(404, 'CONVERSATION_NOT_FOUND');
    const conversation = await Conversation.findById(id.data).select('participants').lean();
    if (!conversation || !isParticipant(conversation, req.auth!.userId)) throw new AppError(404, 'CONVERSATION_NOT_FOUND');
    const rows = await Message.find({ conversationId: id.data }).sort({ createdAt: -1 }).limit(100).lean();
    const data = rows.reverse().map(messageDto);
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

messagingRoutes.post('/conversations/:conversationId/messages', sendLimiter, requireConversationParticipant, limitAttachmentUploads, receiveMessageAttachment, async (req: AuthRequest, res, next) => {
  let persisted = false;
  let storedKey: string | undefined;
  try {
    const id = objectId.safeParse(req.params.conversationId); if (!id.success) throw new AppError(404, 'CONVERSATION_NOT_FOUND');
    const { text = '' } = z.object({ text: z.string().trim().max(5000).optional() }).strict().parse(req.body);
    if (!text && !req.file) throw new AppError(400, 'MESSAGE_CONTENT_REQUIRED');
    const conversation = await Conversation.findById(id.data).select('participants').lean();
    if (!conversation || !isParticipant(conversation, req.auth!.userId)) throw new AppError(404, 'CONVERSATION_NOT_FOUND');
    let attachment: { name: string; storageKey: string; mimeType: string; size: number; uploadedAt: Date; kind: 'document' } | undefined;
    if (req.file) {
      const bytes = await privateStorage.readUpload(req.file.path);
      let extension: 'pdf' | 'zip' | 'docx' | undefined;
      if (req.file.mimetype === 'application/pdf' && bytes.subarray(0, 5).toString() === '%PDF-') extension = 'pdf';
      else if (['application/zip', 'application/x-zip-compressed'].includes(req.file.mimetype) && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]) && [0x04, 0x06, 0x08].includes(bytes[3])) extension = 'zip';
      else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04 && bytes.includes(Buffer.from('[Content_Types].xml')) && bytes.includes(Buffer.from('word/document.xml'))) extension = 'docx';
      if (!extension) throw new AppError(415, 'INVALID_MESSAGE_ATTACHMENT_CONTENT');
      const storageKey = `${path.basename(req.file.filename, '.upload')}.${extension}`;
      storedKey = storageKey;
      await privateStorage.storeUpload('message-attachments', storageKey, req.file.path);
      attachment = { name: path.basename(req.file.originalname).replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 180) || `message.${extension}`, storageKey, mimeType: req.file.mimetype, size: req.file.size, uploadedAt: new Date(), kind: 'document' };
    }
    const message = await Message.create({ conversationId: id.data, senderId: req.auth!.userId, text, attachment, readBy: [req.auth!.userId] });
    persisted = true;
    const preview = text || (attachment ? `📎 ${attachment.name}` : '');
    await Conversation.updateOne({ _id: id.data, lastMessageAt: { $lte: message.createdAt } }, { $set: { lastMessageText: preview.slice(0, 240), lastMessageAt: message.createdAt, lastSenderId: req.auth!.userId } });
    const recipient = conversation.participants.find(user => String((user as { _id?: unknown })._id || user) !== req.auth!.userId);
    if (recipient) void createNotification({ userId: String((recipient as { _id?: unknown })._id || recipient), type: 'message', title: 'New message', message: (text || 'Sent an attachment.').slice(0, 140), link: '/messages', template: text ? undefined : { key: 'newAttachment' } }).catch(() => undefined);
    const dto = messageDto(message.toObject());
    publishMessageEvent(conversation.participants.map(user => String((user as { _id?: unknown })._id || user)), { id: dto.id, conversationId: dto.conversationId });
    res.status(201).json({ success: true, data: dto });
  } catch (error) { next(error); }
  finally {
    if (req.file && !persisted) {
      await privateStorage.removeUpload(req.file.path).catch(() => undefined);
      if (storedKey) await privateStorage.remove('message-attachments', storedKey).catch(() => undefined);
    }
  }
});

messagingRoutes.get('/attachments/:attachmentId', async (req: AuthRequest, res, next) => {
  try {
    const attachmentId = objectId.safeParse(req.params.attachmentId);
    if (!attachmentId.success) throw new AppError(404, 'MESSAGE_ATTACHMENT_NOT_FOUND');
    const message = await Message.findOne({ 'attachment._id': attachmentId.data, hiddenAt: null }).lean();
    if (!message) throw new AppError(404, 'MESSAGE_ATTACHMENT_NOT_FOUND');
    const conversation = await Conversation.findById(message.conversationId).select('participants').lean();
    if (!conversation || !isParticipant(conversation, req.auth!.userId)) throw new AppError(404, 'MESSAGE_ATTACHMENT_NOT_FOUND');
    const attachment = message.attachment;
    if (!attachment || !/^[a-f0-9-]{36}\.(pdf|zip|docx)$/.test(attachment.storageKey)) throw new AppError(404, 'MESSAGE_ATTACHMENT_NOT_FOUND');
    privateStorage.send('message-attachments', attachment.storageKey, res, { mimeType: attachment.mimeType, downloadName: attachment.name, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' } }, error => { if (error && !res.headersSent) next(new AppError(404, 'MESSAGE_ATTACHMENT_NOT_FOUND')); });
  } catch (error) { next(error); }
});

messagingRoutes.post('/conversations/:conversationId/voice-notes', sendLimiter, requireConversationParticipant, attachmentUploadLimiter, receiveMessageVoice, async (req: AuthRequest, res, next) => {
  let persisted = false;
  let storedKey: string | undefined;
  try {
    const id = objectId.safeParse(req.params.conversationId);
    if (!id.success || !req.file) throw new AppError(400, 'VOICE_NOTE_REQUIRED');
    const { durationSeconds } = z.object({ durationSeconds: z.coerce.number().int().min(1).max(60) }).strict().parse(req.body);
    const conversation = await Conversation.findById(id.data).select('participants').lean();
    if (!conversation || !isParticipant(conversation, req.auth!.userId)) throw new AppError(404, 'CONVERSATION_NOT_FOUND');
    const bytes = await privateStorage.readUpload(req.file.path);
    const mimeType = req.file.mimetype.split(';')[0];
    let extension: 'webm' | 'ogg' | 'm4a' | undefined;
    if (mimeType === 'audio/webm' && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) extension = 'webm';
    else if (mimeType === 'audio/ogg' && bytes.subarray(0, 4).toString('ascii') === 'OggS') extension = 'ogg';
    else if (mimeType === 'audio/mp4' && bytes.length >= 8 && bytes.toString('ascii', 4, 8) === 'ftyp') extension = 'm4a';
    if (!extension) throw new AppError(415, 'INVALID_VOICE_NOTE_CONTENT');
    const storageKey = `${path.basename(req.file.filename, '.upload')}.${extension}`;
    storedKey = storageKey;
    await privateStorage.storeUpload('message-attachments', storageKey, req.file.path);
    const message = await Message.create({ conversationId: id.data, senderId: req.auth!.userId, text: '', attachment: { name: 'Voice note', storageKey, mimeType, size: req.file.size, uploadedAt: new Date(), kind: 'voice', durationSeconds }, readBy: [req.auth!.userId] });
    persisted = true;
    await Conversation.updateOne({ _id: id.data, lastMessageAt: { $lte: message.createdAt } }, { $set: { lastMessageText: `Voice note (${durationSeconds}s)`, lastMessageAt: message.createdAt, lastSenderId: req.auth!.userId } });
    const recipient = conversation.participants.find(user => String((user as { _id?: unknown })._id || user) !== req.auth!.userId);
    if (recipient) void createNotification({ userId: String((recipient as { _id?: unknown })._id || recipient), type: 'message', title: 'New voice message', message: 'You received a voice note.', link: '/messages', template: { key: 'newVoiceMessage' } }).catch(() => undefined);
    const dto = messageDto(message.toObject());
    publishMessageEvent(conversation.participants.map(user => String((user as { _id?: unknown })._id || user)), { id: dto.id, conversationId: dto.conversationId });
    res.status(201).json({ success: true, data: dto });
  } catch (error) { next(error); }
  finally {
    if (req.file && !persisted) {
      await privateStorage.removeUpload(req.file.path).catch(() => undefined);
      if (storedKey) await privateStorage.remove('message-attachments', storedKey).catch(() => undefined);
    }
  }
});

messagingRoutes.get('/voice-notes/:voiceNoteId', async (req: AuthRequest, res, next) => {
  try {
    const voiceNoteId = objectId.safeParse(req.params.voiceNoteId);
    if (!voiceNoteId.success) throw new AppError(404, 'VOICE_NOTE_NOT_FOUND');
    const message = await Message.findOne({ 'attachment._id': voiceNoteId.data, 'attachment.kind': 'voice', hiddenAt: null }).lean();
    if (!message) throw new AppError(404, 'VOICE_NOTE_NOT_FOUND');
    const conversation = await Conversation.findById(message.conversationId).select('participants').lean();
    if (!conversation || !isParticipant(conversation, req.auth!.userId)) throw new AppError(404, 'VOICE_NOTE_NOT_FOUND');
    const voice = message.attachment;
    if (!voice || !/^[a-f0-9-]{36}\.(webm|ogg|m4a)$/.test(voice.storageKey)) throw new AppError(404, 'VOICE_NOTE_NOT_FOUND');
    privateStorage.send('message-attachments', voice.storageKey, res, { mimeType: voice.mimeType, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' } }, error => { if (error && !res.headersSent) next(new AppError(404, 'VOICE_NOTE_NOT_FOUND')); });
  } catch (error) { next(error); }
});

messagingRoutes.patch('/conversations/:conversationId/read', async (req: AuthRequest, res, next) => {
  try {
    const id = objectId.safeParse(req.params.conversationId); if (!id.success) throw new AppError(404, 'CONVERSATION_NOT_FOUND');
    const conversation = await Conversation.findById(id.data).select('participants').lean();
    if (!conversation || !isParticipant(conversation, req.auth!.userId)) throw new AppError(404, 'CONVERSATION_NOT_FOUND');
    await Message.updateMany({ conversationId: id.data, senderId: { $ne: req.auth!.userId }, readBy: { $ne: req.auth!.userId } }, { $addToSet: { readBy: req.auth!.userId } });
    res.json({ success: true, data: { updated: true } });
  } catch (error) { next(error); }
});
