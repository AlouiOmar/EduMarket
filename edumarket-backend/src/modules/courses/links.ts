import dns from 'node:dns/promises';
import net from 'node:net';
import { workingCopy } from './publication.js';
import type { OutlineContainer } from './structure.js';

/**
 * External link checking ("liens morts", EX-LIE-02). URLs come from link items and from the blocks of every item (published
 * content and pending drafts). Requests are made server-side, so they are protected against SSRF: http(s) only, standard ports,
 * every resolved address must be public (no loopback, private, link-local, CGNAT, multicast or reserved ranges).
 */
export interface LinkLocation { itemId: string; title: string; containerTitle: string }

export function collectLinks(chapters: OutlineContainer[]) {
  const found = new Map<string, LinkLocation[]>();
  const add = (url: string, location: LinkLocation) => {
    if (!/^https?:\/\//i.test(url)) return;
    let normalized: string;
    try { normalized = new URL(url).toString(); } catch { return; }
    found.set(normalized, [...(found.get(normalized) || []), location]);
  };
  for (const container of chapters) for (const raw of container.lessons) {
    const item = workingCopy(raw);
    const location = { itemId: item.id, title: String(item.title || ''), containerTitle: container.title };
    if (typeof item.url === 'string') add(item.url, location);
    for (const block of Array.isArray(item.blocks) ? item.blocks as any[] : []) {
      if (typeof block?.html === 'string') for (const match of block.html.matchAll(/href="([^"]+)"/gi)) add(match[1].replace(/&amp;/g, '&'), location);
      if (typeof block?.embedUrl === 'string') add(block.embedUrl, location);
      if (typeof block?.url === 'string') add(block.url, location);
    }
  }
  return found;
}

/** True when an IP address must never be contacted by the server. */
export function isBlockedAddress(address: string) {
  const version = net.isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith('::ffff:')) return isBlockedAddress(lower.slice(7));
    return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') || lower.startsWith('ff');
  }
  return true;
}

export type LinkStatus = 'ok' | 'redirect' | 'broken' | 'error' | 'blocked';
export interface LinkResult { url: string; status: LinkStatus; httpStatus: number | null; finalUrl: string | null; error: string }

/** Checks one URL (HEAD, then GET when HEAD is not allowed), following at most 3 redirects, each hop re-validated. */
export async function checkLink(url: string, options: { allowPrivate?: boolean; timeoutMs?: number } = {}): Promise<LinkResult> {
  let current = url;
  for (let hop = 0; hop <= 3; hop += 1) {
    let parsed: URL;
    try { parsed = new URL(current); } catch { return { url, status: 'error', httpStatus: null, finalUrl: null, error: 'INVALID_URL' }; }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return { url, status: 'blocked', httpStatus: null, finalUrl: current, error: 'UNSUPPORTED_URL' };
    if (!options.allowPrivate) {
      if (parsed.port && !['80', '443', '8080', '8443'].includes(parsed.port)) return { url, status: 'blocked', httpStatus: null, finalUrl: current, error: 'PORT_NOT_ALLOWED' };
      let addresses: string[];
      try { addresses = net.isIP(parsed.hostname) ? [parsed.hostname] : (await dns.lookup(parsed.hostname, { all: true })).map(entry => entry.address); }
      catch { return { url, status: 'broken', httpStatus: null, finalUrl: current, error: 'DNS_FAILURE' }; }
      if (!addresses.length || addresses.some(isBlockedAddress)) return { url, status: 'blocked', httpStatus: null, finalUrl: current, error: 'PRIVATE_ADDRESS' };
    }
    let response: Response;
    try {
      response = await fetch(current, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs ?? 8000), headers: { 'user-agent': 'EduMarket-LinkChecker/1.0' } });
      if ([405, 501, 403].includes(response.status)) response = await fetch(current, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs ?? 8000), headers: { 'user-agent': 'EduMarket-LinkChecker/1.0', range: 'bytes=0-0' } });
    } catch (error) {
      return { url, status: 'broken', httpStatus: null, finalUrl: current, error: (error as Error).name === 'TimeoutError' ? 'TIMEOUT' : 'UNREACHABLE' };
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location')!, current).toString();
      continue;
    }
    const status: LinkStatus = response.status < 300 ? (current === url ? 'ok' : 'redirect') : response.status === 429 ? 'error' : 'broken';
    return { url, status, httpStatus: response.status, finalUrl: current === url ? null : current, error: '' };
  }
  return { url, status: 'broken', httpStatus: null, finalUrl: current, error: 'TOO_MANY_REDIRECTS' };
}

/** Runs checks with a small concurrency (polite to remote servers, bounded server load). */
export async function checkLinks(urls: string[], options: { allowPrivate?: boolean; concurrency?: number; timeoutMs?: number } = {}) {
  const results: LinkResult[] = [];
  const queue = [...urls];
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, queue.length) }, async () => {
    while (queue.length) { const next = queue.shift()!; results.push(await checkLink(next, options)); }
  }));
  return results;
}
