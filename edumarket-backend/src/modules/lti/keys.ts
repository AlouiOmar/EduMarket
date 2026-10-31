import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors.js';

/** Platform keys and JWT checks for LTI 1.3. The private key comes from the environment only (never stored in code or database). */
export const ltiConfigured = () => !!(env.LTI_PRIVATE_KEY && env.LTI_KEY_ID && env.LTI_ISSUER);
const privateKey = () => {
  if (!ltiConfigured()) throw new AppError(503, 'LTI_NOT_CONFIGURED');
  return env.LTI_PRIVATE_KEY!.replace(/\\n/g, '\n');
};
export const issuer = () => env.LTI_ISSUER!.replace(/\/$/, '');
export const tokenEndpoint = () => `${issuer()}/api/v1/lti/token`;

export function platformJwks() {
  const jwk = crypto.createPublicKey(privateKey()).export({ format: 'jwk' }) as Record<string, string>;
  return { keys: [{ kty: jwk.kty, n: jwk.n, e: jwk.e, kid: env.LTI_KEY_ID, alg: 'RS256', use: 'sig' }] };
}

export const signIdToken = (claims: Record<string, unknown>) => jwt.sign(claims, privateKey(), { algorithm: 'RS256', keyid: env.LTI_KEY_ID, expiresIn: 300 });

/** Pseudonymous, stable LTI user id per tool (the tool never learns the EduMarket user id). */
export const ltiSubject = (toolId: string, userId: string) => crypto.createHmac('sha256', env.JWT_SECRET).update(`lti:${toolId}:${userId}`).digest('hex').slice(0, 32);

/** Public key of a tool: PEM, or the key matching `kid` in its JWKS (fetched with a timeout, HTTPS required in production). */
export async function toolPublicKey(tool: { publicKeyPem?: string; jwksUrl?: string }, kid?: string) {
  if (tool.publicKeyPem) return crypto.createPublicKey(tool.publicKeyPem);
  if (!tool.jwksUrl) throw new AppError(401, 'LTI_TOOL_KEY_MISSING');
  if (env.NODE_ENV === 'production' && !tool.jwksUrl.startsWith('https://')) throw new AppError(401, 'LTI_TOOL_KEY_MISSING');
  let keys: Array<Record<string, unknown>>;
  try {
    const response = await fetch(tool.jwksUrl, { signal: AbortSignal.timeout(5000) });
    keys = ((await response.json()) as { keys?: Array<Record<string, unknown>> }).keys || [];
  } catch { throw new AppError(401, 'LTI_TOOL_KEY_UNAVAILABLE'); }
  const key = keys.find(candidate => !kid || candidate.kid === kid);
  if (!key) throw new AppError(401, 'LTI_TOOL_KEY_MISSING');
  return crypto.createPublicKey({ key: key as crypto.JsonWebKey, format: 'jwk' });
}

/**
 * Validates a tool's client assertion (RFC 7523) as LTI 1.3 requires: RS256 signature with the tool key, `iss` = `sub` = client id,
 * `aud` = this platform's token endpoint, unexpired, issued less than 5 minutes ago (not in the future), and a `jti` used once.
 */
export async function verifyClientAssertion(assertion: string, tool: { clientId: string; publicKeyPem?: string; jwksUrl?: string }) {
  const decoded = jwt.decode(assertion, { complete: true });
  if (!decoded || typeof decoded.payload === 'string') throw new AppError(401, 'LTI_INVALID_ASSERTION');
  if (decoded.header.alg !== 'RS256') throw new AppError(401, 'LTI_INVALID_ASSERTION');
  const key = await toolPublicKey(tool, decoded.header.kid);
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(assertion, key, { algorithms: ['RS256'], audience: tokenEndpoint(), issuer: tool.clientId, subject: tool.clientId, clockTolerance: 5 }) as jwt.JwtPayload;
  } catch { throw new AppError(401, 'LTI_INVALID_ASSERTION'); }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || !payload.iat || payload.iat > now + 5 || payload.exp - payload.iat > 300 || !payload.jti) throw new AppError(401, 'LTI_INVALID_ASSERTION');
  return payload;
}
