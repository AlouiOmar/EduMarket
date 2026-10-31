import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../common/errors.js';

/**
 * Payment provider adapters. The server owns every amount: adapters only receive
 * order lines priced from MongoDB, and payment state changes only after a verified
 * provider event (or, in development only, the explicit sandbox confirmation).
 */
export interface CheckoutLine { name: string; unitAmount: number; quantity: 1 }
export interface CheckoutRequest { orderId: string; currency: string; lines: CheckoutLine[]; customerEmail: string; successUrl: string; cancelUrl: string; expiresAt: Date }
export interface CheckoutResult { sessionId: string; url: string }
export type ProviderEvent =
  | { id: string; kind: 'payment_succeeded'; sessionId: string; paymentId: string; amountTotal: number; currency: string }
  | { id: string; kind: 'payment_failed'; sessionId: string }
  | { id: string; kind: 'ignored' };

export interface PaymentProvider {
  readonly name: 'sandbox' | 'stripe';
  createCheckout(input: CheckoutRequest): Promise<CheckoutResult>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderEvent;
  refund(paymentId: string, amount: number, idempotencyKey: string): Promise<{ refundId: string }>;
}

const header = (headers: Record<string, string | string[] | undefined>, name: string) => {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

const safeEqualHex = (expected: string, received: string) => {
  const a = Buffer.from(expected, 'hex'), b = Buffer.from(received, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
};

/** Signs a sandbox webhook payload; exported for tests and local tooling. */
export const signSandboxPayload = (payload: string, timestamp: number, secret: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');

const WEBHOOK_TOLERANCE_SECONDS = 300;

class SandboxProvider implements PaymentProvider {
  readonly name = 'sandbox' as const;
  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    const sessionId = `sbx_cs_${randomBytes(18).toString('hex')}`;
    return { sessionId, url: `${env.APP_ORIGIN.replace(/\/$/, '')}/checkout/sandbox/${sessionId}?order=${input.orderId}` };
  }
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderEvent {
    if (!env.SANDBOX_WEBHOOK_SECRET) throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED');
    const signature = header(headers, 'x-sandbox-signature') || '';
    const [, timestampText, digest] = /^t=(\d+),v1=([a-f0-9]+)$/.exec(signature) || [];
    const timestamp = Number(timestampText);
    if (!timestamp || !digest || Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) throw new AppError(400, 'INVALID_WEBHOOK_SIGNATURE');
    if (!safeEqualHex(signSandboxPayload(rawBody.toString('utf8'), timestamp, env.SANDBOX_WEBHOOK_SECRET), digest)) throw new AppError(400, 'INVALID_WEBHOOK_SIGNATURE');
    return parseSandboxEvent(JSON.parse(rawBody.toString('utf8')));
  }
  async refund(paymentId: string): Promise<{ refundId: string }> {
    return { refundId: `sbx_re_${paymentId.slice(-12)}_${randomBytes(6).toString('hex')}` };
  }
}

export const parseSandboxEvent = (event: any): ProviderEvent => {
  if (typeof event?.id !== 'string') throw new AppError(400, 'INVALID_WEBHOOK_PAYLOAD');
  if (event.type === 'payment.succeeded') return { id: event.id, kind: 'payment_succeeded', sessionId: String(event.sessionId), paymentId: String(event.paymentId), amountTotal: Number(event.amountTotal), currency: String(event.currency) };
  if (event.type === 'payment.failed') return { id: event.id, kind: 'payment_failed', sessionId: String(event.sessionId) };
  return { id: event.id, kind: 'ignored' };
};

class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  constructor(private secretKey: string, private webhookSecret: string) {}

  private async call(path: string, form: URLSearchParams, idempotencyKey: string) {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': idempotencyKey },
      body: form,
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
      console.error('Stripe request failed', { path, status: response.status, type: payload?.error?.type, code: payload?.error?.code });
      throw new AppError(502, 'PAYMENT_PROVIDER_ERROR');
    }
    return payload;
  }

  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    const form = new URLSearchParams({
      mode: 'payment', success_url: input.successUrl, cancel_url: input.cancelUrl,
      client_reference_id: input.orderId, 'metadata[orderId]': input.orderId, customer_email: input.customerEmail,
      expires_at: String(Math.floor(input.expiresAt.getTime() / 1000)),
    });
    input.lines.forEach((line, index) => {
      form.set(`line_items[${index}][quantity]`, String(line.quantity));
      form.set(`line_items[${index}][price_data][currency]`, input.currency);
      form.set(`line_items[${index}][price_data][unit_amount]`, String(line.unitAmount));
      form.set(`line_items[${index}][price_data][product_data][name]`, line.name.slice(0, 250));
    });
    const session = await this.call('checkout/sessions', form, `checkout-${input.orderId}`);
    return { sessionId: session.id, url: session.url };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderEvent {
    const signature = header(headers, 'stripe-signature') || '';
    const parts = signature.split(',').map(part => part.split('='));
    const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
    const digests = parts.filter(([key]) => key === 'v1').map(([, value]) => value || '');
    if (!timestamp || !digests.length || Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) throw new AppError(400, 'INVALID_WEBHOOK_SIGNATURE');
    const expected = createHmac('sha256', this.webhookSecret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
    if (!digests.some(digest => safeEqualHex(expected, digest))) throw new AppError(400, 'INVALID_WEBHOOK_SIGNATURE');
    const event = JSON.parse(rawBody.toString('utf8'));
    const session = event?.data?.object;
    if (typeof event?.id !== 'string') throw new AppError(400, 'INVALID_WEBHOOK_PAYLOAD');
    if ((event.type === 'checkout.session.completed' && session?.payment_status === 'paid') || event.type === 'checkout.session.async_payment_succeeded') {
      return { id: event.id, kind: 'payment_succeeded', sessionId: String(session.id), paymentId: String(session.payment_intent), amountTotal: Number(session.amount_total), currency: String(session.currency) };
    }
    if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') return { id: event.id, kind: 'payment_failed', sessionId: String(session.id) };
    return { id: event.id, kind: 'ignored' };
  }

  async refund(paymentId: string, amount: number, idempotencyKey: string): Promise<{ refundId: string }> {
    const refund = await this.call('refunds', new URLSearchParams({ payment_intent: paymentId, amount: String(amount) }), idempotencyKey);
    return { refundId: refund.id };
  }
}

let cachedProvider: PaymentProvider | null | undefined;
export function getPaymentProvider(): PaymentProvider | null {
  if (cachedProvider !== undefined) return cachedProvider;
  if (env.PAYMENT_PROVIDER === 'stripe') cachedProvider = new StripeProvider(env.STRIPE_SECRET_KEY!, env.STRIPE_WEBHOOK_SECRET!);
  else if (env.PAYMENT_PROVIDER === 'sandbox') cachedProvider = new SandboxProvider();
  else cachedProvider = null;
  return cachedProvider;
}

export function requirePaymentProvider(): PaymentProvider {
  const provider = getPaymentProvider();
  if (!provider) throw new AppError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED');
  return provider;
}
