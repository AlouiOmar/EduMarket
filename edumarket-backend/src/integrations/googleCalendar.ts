import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Encryption at rest (AES-256-GCM) of calendar provider tokens (Google, Microsoft). Tokens are never returned to clients nor logged.
 * The provider adapters themselves live in `calendarProviders/`.
 */
// Tokens are encrypted with CALENDAR_TOKEN_KEY when set, otherwise with a key derived from JWT_SECRET (original behaviour).
const legacyKey = () => createHash('sha256').update(`edumarket-google-calendar:${env.JWT_SECRET}`).digest();
const key = () => env.CALENDAR_TOKEN_KEY ? createHash('sha256').update(`edumarket-calendar-tokens:${env.CALENDAR_TOKEN_KEY}`).digest() : legacyKey();

export function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

function decryptWith(secret: Buffer, value: string) {
  const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', secret, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Tries the current key, then the JWT-derived key, so introducing CALENDAR_TOKEN_KEY does not disconnect anyone. */
export function decryptToken(value: string) {
  try { return decryptWith(key(), value); }
  catch (error) { if (!env.CALENDAR_TOKEN_KEY) throw error; return decryptWith(legacyKey(), value); }
}
