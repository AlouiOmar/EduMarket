import { env } from '../config/env.js';
import { AppError } from '../common/errors.js';

export function ensureEmailProviderAvailable() {
  if (env.NODE_ENV === 'production' && !env.RESEND_API_KEY) throw new AppError(503, 'EMAIL_PROVIDER_NOT_CONFIGURED');
}

export async function sendAuthEmail(input: { to: string; subject: string; actionUrl: string; actionLabel: string }) {
  const safeUrl = input.actionUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<p>Use the secure link below to continue with your EduMarket account.</p><p><a href="${safeUrl}">${input.actionLabel}</a></p><p>If you did not request this, you can ignore this message.</p>`;
  if (env.NODE_ENV === 'test') return { previewUrl: input.actionUrl, delivery: 'development-preview' as const };
  if (!env.RESEND_API_KEY) {
    return { previewUrl: input.actionUrl, delivery: 'development-preview' as const };
  }

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [input.to], subject: input.subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError(502, 'EMAIL_DELIVERY_FAILED');
  }
  if (!response.ok) throw new AppError(502, 'EMAIL_DELIVERY_FAILED');
  return { delivery: 'sent' as const };
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Notification e-mail (opt-in per account). Without RESEND_API_KEY nothing is sent and `skipped` is returned:
 * the in-app notification remains the source of truth.
 */
/** `transactional`: a message about the user's own file (e.g. a teacher application decision), sent whatever the e-mail preference. */
export async function sendNotificationEmail(input: { to: string; title: string; message: string; link?: string; transactional?: boolean }) {
  if (env.NODE_ENV === 'test' || !env.RESEND_API_KEY) return { delivery: 'skipped' as const };
  const url = input.link ? new URL(input.link, env.APP_ORIGIN).toString() : env.APP_ORIGIN;
  const html = `<p><strong>${escapeHtml(input.title)}</strong></p><p>${escapeHtml(input.message)}</p><p><a href="${escapeHtml(url)}">EduMarket</a></p>`
    + (input.transactional ? '<p style="color:#64748b;font-size:12px">You receive this e-mail about your own EduMarket application. No document is attached: sign in to EduMarket to see it.</p>' : '<p style="color:#64748b;font-size:12px">You receive this e-mail because e-mail notifications are enabled in your EduMarket profile.</p>');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [input.to], subject: `EduMarket · ${input.title}`, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new AppError(502, 'EMAIL_DELIVERY_FAILED');
  return { delivery: 'sent' as const };
}
