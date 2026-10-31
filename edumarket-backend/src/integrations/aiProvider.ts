import { env } from '../config/env.js';
import { AppError } from '../common/errors.js';

/**
 * Server-side chat provider used by AI conversation activities. The API key stays on the server; the browser only talks to
 * EduMarket. Supported: Anthropic Messages API, and any OpenAI-compatible /chat/completions endpoint (OpenAI, Mistral, Ollama…).
 * Without configuration the feature reports itself as not operational (no simulated answers).
 */
export interface ChatTurn { role: 'user' | 'assistant'; content: string }
export interface ChatResult { text: string; inputTokens: number | null; outputTokens: number | null }

export const aiStatus = () => ({
  configured: env.AI_PROVIDER !== 'none',
  provider: env.AI_PROVIDER,
  model: env.AI_PROVIDER === 'none' ? null : env.AI_MODEL || (env.AI_PROVIDER === 'anthropic' ? 'claude-sonnet-5-5' : null),
});

async function call(url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(env.AI_TIMEOUT_MS) });
  } catch (error) {
    throw new AppError((error as Error).name === 'TimeoutError' ? 504 : 502, (error as Error).name === 'TimeoutError' ? 'AI_PROVIDER_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE');
  }
  if (response.status === 429) throw new AppError(503, 'AI_PROVIDER_RATE_LIMITED');
  if (response.status === 401 || response.status === 403) throw new AppError(502, 'AI_PROVIDER_AUTH_FAILED');
  if (!response.ok) throw new AppError(502, 'AI_PROVIDER_ERROR');
  try { return await response.json() as any; } catch { throw new AppError(502, 'AI_PROVIDER_ERROR'); }
}

export async function chat(system: string, turns: ChatTurn[]): Promise<ChatResult> {
  const status = aiStatus();
  if (!status.configured || !status.model) throw new AppError(503, 'AI_PROVIDER_NOT_CONFIGURED');
  if (env.AI_PROVIDER === 'anthropic') {
    const data = await call('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.AI_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: status.model, max_tokens: env.AI_MAX_OUTPUT_TOKENS, system, messages: turns }),
    });
    const text = Array.isArray(data?.content) ? data.content.filter((part: any) => part?.type === 'text').map((part: any) => String(part.text)).join('\n').trim() : '';
    if (!text) throw new AppError(502, 'AI_PROVIDER_EMPTY_RESPONSE');
    return { text, inputTokens: data?.usage?.input_tokens ?? null, outputTokens: data?.usage?.output_tokens ?? null };
  }
  const data = await call(`${env.AI_BASE_URL!.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(env.AI_API_KEY ? { authorization: `Bearer ${env.AI_API_KEY}` } : {}) },
    body: JSON.stringify({ model: status.model, max_tokens: env.AI_MAX_OUTPUT_TOKENS, messages: [{ role: 'system', content: system }, ...turns] }),
  });
  const text = String(data?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new AppError(502, 'AI_PROVIDER_EMPTY_RESPONSE');
  return { text, inputTokens: data?.usage?.prompt_tokens ?? null, outputTokens: data?.usage?.completion_tokens ?? null };
}
