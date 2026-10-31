import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';

/**
 * Lesson blocks and their HTML security policy.
 *
 * Teacher HTML is never executed: it is sanitized on write against an allow-list (no script, no event handler, no
 * `javascript:`/`data:` link, no iframe/object/form) and the `html` block is additionally rendered by the client inside a
 * sandboxed iframe without script permission. Only https (and mailto for links) URLs survive.
 */
const TEXT_TAGS = ['h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'a', 'ul', 'ol', 'li',
  'blockquote', 'code', 'pre', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'span'];

const safeLink = (attribs: Record<string, string>) => ({ ...attribs, rel: 'noopener noreferrer nofollow', target: '_blank' });

const TEXT_POLICY: sanitizeHtml.IOptions = {
  allowedTags: TEXT_TAGS,
  allowedAttributes: { a: ['href', 'title', 'rel', 'target'], th: ['scope', 'colspan', 'rowspan'], td: ['colspan', 'rowspan'], code: ['class'], span: ['lang', 'dir'], p: ['dir'] },
  allowedClasses: { code: [/^language-[a-z0-9-]+$/] },
  allowedSchemes: ['https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: { a: (tagName, attribs) => ({ tagName, attribs: safeLink(attribs) }) },
};

const HTML_POLICY: sanitizeHtml.IOptions = {
  ...TEXT_POLICY,
  allowedTags: [...TEXT_TAGS, 'h1', 'h5', 'h6', 'div', 'section', 'article', 'aside', 'header', 'footer', 'figure', 'figcaption',
    'img', 'details', 'summary', 'dl', 'dt', 'dd', 'mark', 'small', 'abbr', 'kbd', 'samp', 'var', 'cite', 'q', 'time'],
  allowedAttributes: {
    ...TEXT_POLICY.allowedAttributes,
    '*': ['class', 'style', 'lang', 'dir', 'title'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    abbr: ['title'], time: ['datetime'], details: ['open'],
  },
  allowedClasses: undefined,
  allowedSchemes: ['https', 'mailto'],
  allowedSchemesByTag: { img: ['https'] },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  // Presentational CSS only: no url(), expression() or positioning that could overlay the page.
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
      'text-align': [/^(left|right|center|justify|start|end)$/],
      'font-weight': [/^(normal|bold|[1-9]00)$/],
      'font-style': [/^(normal|italic)$/],
      'text-decoration': [/^(none|underline|line-through)$/],
      'font-size': [/^\d{1,2}(\.\d+)?(px|em|rem|%)$/],
      padding: [/^[\d.\s]+(px|em|rem|%)?([\d.\s]+(px|em|rem|%)?)*$/],
      margin: [/^[\d.\s]+(px|em|rem|%)?([\d.\s]+(px|em|rem|%)?)*$/],
      border: [/^\d+px (solid|dashed|dotted) (#[0-9a-f]{3,8}|[a-z]+)$/i],
      'border-radius': [/^\d+(px|em|rem|%)$/],
      width: [/^\d+(px|%)$/], 'max-width': [/^\d+(px|%)$/],
      display: [/^(block|inline|inline-block|flex|grid|none)$/],
      gap: [/^\d+(px|em|rem)$/],
    },
  },
};

export const sanitizeRichText = (html: string) => sanitizeHtml(html, TEXT_POLICY).trim();
export const sanitizeHtmlBlock = (html: string) => sanitizeHtml(html, HTML_POLICY).trim();

/** YouTube / Vimeo URLs normalized to privacy-friendly embed URLs; anything else is refused. */
export function normalizeEmbedUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
  const id = (value: string | null | undefined, pattern: RegExp) => value && pattern.test(value) ? value : null;
  const youtubeId = /^[\w-]{11}$/;
  if (host === 'youtu.be') { const value = id(url.pathname.slice(1), youtubeId); return value ? `https://www.youtube-nocookie.com/embed/${value}` : null; }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const value = url.pathname === '/watch' ? id(url.searchParams.get('v'), youtubeId) : id(url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/)?.[1], youtubeId);
    return value ? `https://www.youtube-nocookie.com/embed/${value}` : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const value = url.pathname.match(/^\/(?:video\/)?(\d{4,12})$/)?.[1];
    return value ? `https://player.vimeo.com/video/${value}` : null;
  }
  return null;
}

export const CODE_LANGUAGES = ['typescript', 'javascript', 'html', 'css', 'scss', 'json', 'bash', 'python', 'java', 'sql', 'plaintext'] as const;
const blockId = z.string().trim().min(1).max(100);
const assetId = z.string().regex(/^[a-f\d]{24}$/i);
const httpsUrl = z.string().trim().max(2000).url().refine(value => value.startsWith('https://'), 'HTTPS_REQUIRED');

/** KaTeX runs with `trust: false`; these commands are refused anyway (links, external resources, raw HTML attributes). */
const UNSAFE_LATEX = /\\(href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData)\b/i;
export const blockSchema = z.discriminatedUnion('type', [
  z.object({ id: blockId, type: z.literal('text'), html: z.string().max(60000).transform(sanitizeRichText) }),
  z.object({ id: blockId, type: z.literal('html'), html: z.string().max(60000).transform(sanitizeHtmlBlock), title: z.string().trim().max(200).default('') }),
  z.object({ id: blockId, type: z.literal('code'), language: z.enum(CODE_LANGUAGES), code: z.string().max(20000), filename: z.string().trim().max(120).default(''), caption: z.string().trim().max(300).default('') }),
  z.object({
    id: blockId, type: z.literal('image'), assetId: assetId.optional(), url: httpsUrl.optional(),
    alt: z.string().trim().max(300).default(''), decorative: z.boolean().default(false), caption: z.string().trim().max(300).default(''),
  }),
  z.object({
    id: blockId, type: z.literal('video'), title: z.string().trim().min(1).max(200), assetId: assetId.optional(), captionsAssetId: assetId.optional(),
    embedUrl: z.string().max(2000).optional().transform((value, context) => {
      if (value === undefined || value === '') return undefined;
      const normalized = normalizeEmbedUrl(value);
      if (!normalized) { context.addIssue({ code: z.ZodIssueCode.custom, message: 'UNSUPPORTED_VIDEO_URL' }); return z.NEVER; }
      return normalized;
    }),
    transcript: z.string().max(20000).default(''),
  }),
  z.object({ id: blockId, type: z.literal('file'), assetId, title: z.string().trim().max(200).default('') }),
  z.object({ id: blockId, type: z.literal('quiz') }),
  z.object({ id: blockId, type: z.literal('divider') }),
  // LaTeX source only (never HTML); rendered by KaTeX in the browser with MathML for screen readers. `description`: text alternative.
  z.object({ id: blockId, type: z.literal('math'), latex: z.string().trim().min(1).max(4000).refine(value => !UNSAFE_LATEX.test(value), 'UNSAFE_LATEX'), display: z.enum(['block', 'inline']).default('block'), description: z.string().trim().max(500).default('') }),
]).superRefine((block, context) => {
  const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  if (block.type === 'image') {
    if (!!block.assetId === !!block.url) issue('IMAGE_SOURCE_REQUIRED');
    if (!block.decorative && !block.alt) issue('IMAGE_ALT_REQUIRED');
  }
  if (block.type === 'video' && !!block.assetId === !!block.embedUrl) issue('VIDEO_SOURCE_REQUIRED');
});
export const blocksSchema = z.array(blockSchema).max(100)
  .refine(blocks => new Set(blocks.map(block => block.id)).size === blocks.length, 'DUPLICATE_BLOCK_ID')
  .refine(blocks => blocks.filter(block => block.type === 'quiz').length <= 1, 'SINGLE_QUIZ_BLOCK');
export type LessonBlock = z.infer<typeof blockSchema>;

/** Asset ids referenced by blocks (used for access checks and course copies). */
export const blockAssetIds = (blocks: unknown): string[] => (Array.isArray(blocks) ? blocks : []).flatMap((block: any) =>
  [block?.assetId, block?.captionsAssetId].filter((value): value is string => typeof value === 'string' && value.length > 0));
