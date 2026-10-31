import { expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Shared fixtures of the LMS specs: users, courses and enrollments are inserted directly into the isolated `_test` database
 * (the same database the Playwright API server uses), then every scenario goes through the real UI and API.
 */
const frontendRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const backendDir = process.env.EDUMARKET_BACKEND_DIR || [path.join(frontendRoot, 'backend'), path.join(frontendRoot, '..', 'edumarket-backend')].find(candidate => existsSync(path.join(candidate, 'package.json')))!;
const backendRequire = createRequire(path.join(backendDir, 'package.json'));
type Collection = {
  insertOne: (doc: Record<string, unknown>) => Promise<{ insertedId: unknown }>;
  updateOne: (filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
  findOne: (filter: Record<string, unknown>) => Promise<(Record<string, any> & { _id: unknown }) | null>;
  countDocuments: (filter: Record<string, unknown>) => Promise<number>;
};
type Connection = { collection: (name: string) => Collection; close: () => Promise<void> };
const mongoose = backendRequire('mongoose') as { createConnection: (uri: string) => { asPromise: () => Promise<Connection> }; Types: { ObjectId: new (id: string) => unknown } };
/** ObjectId from a hex string (ids read back from the API). */
export const objectId = (hex: string) => new mongoose.Types.ObjectId(hex);
const bcrypt = backendRequire('bcryptjs') as { hash: (value: string, rounds: number) => Promise<string> };

export const api = 'http://127.0.0.1:4400/api/v1';
export const password = 'E2e-lms-password-2026';

export async function withDb<T>(work: (db: Connection) => Promise<T>) {
  const connection = await mongoose.createConnection(process.env.EDUMARKET_TEST_MONGO_URI!).asPromise();
  try { return await work(connection); } finally { await connection.close(); }
}

export async function seedUser(db: Connection, role: 'teacher' | 'student' | 'admin', name: string, email: string) {
  const now = new Date();
  const base = { passwordHash: await bcrypt.hash(password, 10), status: 'active', emailVerified: true, headline: '', bio: '', phone: '', favoriteCourseIds: [], authVersion: 0, notificationPreferences: { sessions: true, messages: true, courseActivity: true }, createdAt: now, updatedAt: now };
  const extra = role === 'admin' ? { verified: true } : role === 'teacher' ? { verified: true, teacherVerification: { specialty: 'Angular', registrationNumber: '', credentialsSummary: 'Fixture', status: 'approved', submittedAt: now, reviewNote: '', documents: [] } } : { verified: false };
  return (await db.collection('users').insertOne({ ...base, ...extra, name, email, role })).insertedId;
}

export async function seedCourse(db: Connection, teacherId: unknown, title: string, chapters: unknown[], extra: Record<string, unknown> = {}) {
  const now = new Date();
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return (await db.collection('courses').insertOne({
    title, slug, subtitle: '', description: 'Angular 21', category: 'testing', level: 'beginner', price: 0, rating: 0, ratingCount: 0, studentsCount: 0, tags: [],
    hasCertification: false, certificationPathway: 'learning_and_quiz', prerequisites: [], learningOutcomes: [], teacherId, coOwnerIds: [], visibility: 'public',
    status: 'published', accessState: 'open', structureVersion: 0, createdAt: now, updatedAt: now, chapters, ...extra,
  })).insertedId;
}

export async function enroll(db: Connection, studentId: unknown, courseId: unknown) {
  const now = new Date();
  await db.collection('enrollments').insertOne({ studentId, courseId, completedLessonIds: [], enrolledAt: now, lastAccessedAt: now, completedAt: null, accessType: 'free', accessExpiresAt: null, createdAt: now, updatedAt: now });
  await db.collection('platformsettings').updateOne({ _id: 'global' as never }, { $set: { maintenanceMode: false } }, { upsert: true });
}

export const lesson = (id: string, chapterId: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ id, chapterId, title, type: 'text', durationMinutes: 10, resources: [], commentsCount: 0, visibility: 'visible', revision: 0, ...extra });

export async function login(page: Page, email: string) {
  await page.goto('/auth/login');
  const form = page.locator('form');
  await form.locator('input[type="email"]').fill(email);
  await form.locator('input[type="password"]').fill(password);
  await form.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/auth\/login/);
}

export const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.test`;

/** ESM module of the built backend (e.g. its ZIP writer), to build fixtures with the same code the server reads them with. */
export const backendModule = async <T>(relative: string): Promise<T> => import(pathToFileURL(path.join(backendDir, 'dist', relative)).href) as Promise<T>;
