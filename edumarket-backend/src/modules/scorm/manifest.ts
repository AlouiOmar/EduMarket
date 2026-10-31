/**
 * SCORM package validation (pure): manifest parsing, file policy, runtime data (CMI) validation.
 * Supported: SCORM 1.2 and SCORM 2004 (2nd–4th edition), single launchable SCO per package (the first organization item).
 */
export type ScormVersion = '1.2' | '2004';
export interface ParsedManifest { version: ScormVersion; identifier: string; title: string; launchPath: string }
export class ScormError extends Error { constructor(public code: string) { super(code); } }

const attr = (tag: string, name: string) => {
  const match = new RegExp(`\\s${name.replace(':', '\\:')}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return match ? (match[2] ?? match[3] ?? '') : '';
};
const decode = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Normalized package-relative path of the launch file (query strings kept out), or null when unsafe. */
function packagePath(base: string, href: string) {
  const clean = decode(href).split('?')[0].split('#')[0];
  if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith('/') || clean.includes('\\')) return null;
  const parts: string[] = [];
  for (const part of `${base}${clean}`.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(part);
  }
  return parts.join('/');
}

export function parseManifest(xml: string): ParsedManifest {
  if (!/<manifest[\s>]/i.test(xml)) throw new ScormError('SCORM_MANIFEST_INVALID');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ScormError('SCORM_MANIFEST_INVALID');
  const manifestTag = /<manifest\b[^>]*>/i.exec(xml)?.[0] || '';
  const schemaVersion = /<(?:\w+:)?schemaversion>\s*([^<]+?)\s*<\/(?:\w+:)?schemaversion>/i.exec(xml)?.[1] || '';
  const version: ScormVersion | null = /^1\.2$/.test(schemaVersion) || /adlcp_rootv1p2/i.test(xml) ? '1.2' : /2004|CAM 1\.3/i.test(schemaVersion) || /adlcp_v1p3|adlcp_rootv1p3/i.test(xml) ? '2004' : null;
  if (!version) throw new ScormError('SCORM_VERSION_UNSUPPORTED');
  const organizations = /<organizations\b[^>]*>([\s\S]*?)<\/organizations>/i.exec(xml);
  if (!organizations) throw new ScormError('SCORM_MANIFEST_INVALID');
  const defaultOrg = attr(/<organizations\b[^>]*>/i.exec(xml)![0], 'default');
  const orgs = [...organizations[1].matchAll(/<organization\b([^>]*)>([\s\S]*?)<\/organization>/gi)];
  const org = orgs.find(match => attr(`<o ${match[1]}>`, 'identifier') === defaultOrg) || orgs[0];
  if (!org) throw new ScormError('SCORM_MANIFEST_INVALID');
  const title = decode(/<title>\s*([^<]*?)\s*<\/title>/i.exec(org[2])?.[1] || '') || 'SCORM';
  const itemTags = [...org[2].matchAll(/<item\b[^>]*>/gi)].map(match => match[0]).filter(tag => attr(tag, 'identifierref'));
  if (!itemTags.length) throw new ScormError('SCORM_LAUNCH_MISSING');
  const ref = attr(itemTags[0], 'identifierref');
  const xmlBase = attr(/<resources\b[^>]*>/i.exec(xml)?.[0] || '', 'xml:base');
  const resource = [...xml.matchAll(/<resource\b[^>]*>/gi)].map(match => match[0]).find(tag => attr(tag, 'identifier') === ref);
  if (!resource) throw new ScormError('SCORM_LAUNCH_MISSING');
  const href = attr(resource, 'href');
  const base = `${xmlBase}${attr(resource, 'xml:base')}`.replace(/^\/+/, '');
  const launchPath = href ? packagePath(base && !base.endsWith('/') ? `${base}/` : base, href) : null;
  if (!launchPath) throw new ScormError('SCORM_LAUNCH_MISSING');
  return { version, identifier: attr(manifestTag, 'identifier') || 'package', title: title.slice(0, 200), launchPath };
}

/** Static web content only: scripts run inside the isolated player origin, server-side code and binaries are refused. */
export const ALLOWED_EXTENSIONS = new Set(['html', 'htm', 'xhtml', 'js', 'mjs', 'css', 'json', 'xml', 'xsd', 'dtd', 'txt', 'vtt', 'srt', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'mp4', 'webm', 'ogg', 'ogv', 'mp3', 'wav', 'm4a', 'aac', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'pdf', 'csv', 'map']);
export function checkFilePolicy(paths: string[]) {
  for (const path of paths) {
    const name = path.split('/').pop() || '';
    const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
    if (!ALLOWED_EXTENSIONS.has(extension)) throw new ScormError('SCORM_FORBIDDEN_FILE');
  }
}

export const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', xhtml: 'application/xhtml+xml', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json', xml: 'application/xml', xsd: 'application/xml', dtd: 'application/xml-dtd', txt: 'text/plain; charset=utf-8',
  vtt: 'text/vtt', srt: 'text/plain; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  ico: 'image/x-icon', bmp: 'image/bmp', mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', ogv: 'video/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
  aac: 'audio/aac', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject', pdf: 'application/pdf', csv: 'text/csv', map: 'application/json',
};

/** Writable runtime elements per version, with their constraints. Everything else written by content is ignored. */
const VOCAB_12 = ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'];
const SCORE = (value: string) => value === '' || (/^-?\d+(\.\d+)?$/.test(value) && Math.abs(Number(value)) <= 100000);
const RULES: Record<ScormVersion, Record<string, (value: string) => boolean>> = {
  '1.2': {
    'cmi.core.lesson_status': value => VOCAB_12.includes(value), 'cmi.core.score.raw': SCORE, 'cmi.core.score.min': SCORE, 'cmi.core.score.max': SCORE,
    'cmi.core.lesson_location': value => value.length <= 255, 'cmi.suspend_data': value => value.length <= 4096, 'cmi.core.session_time': value => /^\d{2,4}:\d{2}:\d{2}(\.\d{1,2})?$/.test(value),
    'cmi.core.exit': value => ['time-out', 'suspend', 'logout', ''].includes(value),
  },
  '2004': {
    'cmi.completion_status': value => ['completed', 'incomplete', 'not attempted', 'unknown'].includes(value), 'cmi.success_status': value => ['passed', 'failed', 'unknown'].includes(value),
    'cmi.score.scaled': value => value === '' || (/^-?\d+(\.\d+)?$/.test(value) && Number(value) >= -1 && Number(value) <= 1), 'cmi.score.raw': SCORE, 'cmi.score.min': SCORE, 'cmi.score.max': SCORE,
    'cmi.location': value => value.length <= 1000, 'cmi.suspend_data': value => value.length <= 64000, 'cmi.session_time': value => /^P(\d+Y)?(\d+M)?(\d+D)?(T(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/.test(value),
    'cmi.exit': value => ['time-out', 'suspend', 'logout', 'normal', ''].includes(value), 'cmi.progress_measure': value => value === '' || (/^\d+(\.\d+)?$/.test(value) && Number(value) <= 1),
  },
};
export const isWritable = (version: ScormVersion, key: string) => key in RULES[version];

/** Keeps only valid writable elements; returns the accepted values and the rejected keys. */
export function validateCmi(version: ScormVersion, values: Record<string, unknown>) {
  const accepted: Record<string, string> = {}, rejected: string[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const value = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : null;
    const rule = RULES[version][key];
    if (rule && value !== null && rule(value)) accepted[key] = value; else rejected.push(key);
  }
  return { accepted, rejected };
}

/** Normalized outcome of the runtime data (used for progress and the gradebook). */
export function outcome(version: ScormVersion, cmi: Record<string, string>) {
  if (version === '1.2') {
    const status = cmi['cmi.core.lesson_status'] || 'not attempted';
    const raw = cmi['cmi.core.score.raw'], max = cmi['cmi.core.score.max'] || '100', min = cmi['cmi.core.score.min'] || '0';
    const percent = raw !== undefined && raw !== '' && Number(max) > Number(min) ? Math.max(0, Math.min(100, (Number(raw) - Number(min)) / (Number(max) - Number(min)) * 100)) : null;
    return { completed: ['completed', 'passed', 'failed'].includes(status), passed: status === 'passed' ? true : status === 'failed' ? false : null, percent, suspended: cmi['cmi.core.exit'] === 'suspend' };
  }
  const completion = cmi['cmi.completion_status'] || 'unknown', success = cmi['cmi.success_status'] || 'unknown';
  const scaled = cmi['cmi.score.scaled'];
  const raw = cmi['cmi.score.raw'], max = cmi['cmi.score.max'], min = cmi['cmi.score.min'] || '0';
  const percent = scaled !== undefined && scaled !== '' ? Math.max(0, Math.min(100, Number(scaled) * 100)) : raw !== undefined && raw !== '' && max && Number(max) > Number(min) ? Math.max(0, Math.min(100, (Number(raw) - Number(min)) / (Number(max) - Number(min)) * 100)) : null;
  return { completed: completion === 'completed', passed: success === 'passed' ? true : success === 'failed' ? false : null, percent, suspended: cmi['cmi.exit'] === 'suspend' };
}
