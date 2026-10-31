import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import sql from 'highlight.js/lib/languages/sql';
import plaintext from 'highlight.js/lib/languages/plaintext';
import 'highlight.js/styles/github-dark.css';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Check, Copy, Download, FileText, HelpCircle } from 'lucide-react';
import { apiAssetUrl, downloadApiFile } from '../../services/apiClient';
import type { LessonBlock } from '../../types';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('python', python);
hljs.registerLanguage('java', java);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('plaintext', plaintext);

export const formatBytes = (size: number) => size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} Mo` : `${Math.max(1, Math.round(size / 1024))} Ko`;

/** Server-sanitized rich text, sanitized again in the browser (defense in depth) before insertion. */
export const RichTextView: React.FC<{ html: string; className?: string }> = ({ html, className = '' }) => {
  const clean = useMemo(() => DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'iframe'], ADD_ATTR: ['target'] }), [html]);
  return <div className={`lesson-rich-text ${className}`} dangerouslySetInnerHTML={{ __html: clean }} />;
};

const highlight = (code: string, language: string) => {
  try { return hljs.highlight(code, { language: hljs.getLanguage(language) ? language : 'plaintext' }).value; }
  catch { return hljs.highlight(code, { language: 'plaintext' }).value; }
};

export const CodeBlockView: React.FC<{ code: string; language: string; filename?: string; caption?: string }> = ({ code, language, filename, caption }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  // highlight.js escapes the source: its output contains only its own <span class="hljs-…"> markup.
  const highlighted = useMemo(() => highlight(code, language), [code, language]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };
  return (
    <figure className="rounded-xl overflow-hidden border border-slate-800 bg-[#0d1117]">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-900 text-[11px] text-slate-300">
        <span className="font-mono">{filename || language}</span>
        <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 rounded px-2 py-0.5 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400">
          {copied ? <Check className="w-3 h-3" aria-hidden /> : <Copy className="w-3 h-3" aria-hidden />}
          <span>{copied ? t('blockUi.copied') : t('blockUi.copyCode')}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-relaxed" tabIndex={0} aria-label={t('blockUi.codeRegion', { language })}><code className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
      {caption && <figcaption className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-800">{caption}</figcaption>}
    </figure>
  );
};

/**
 * Teacher HTML runs in a sandboxed iframe without script permission (no `allow-scripts`), with a restrictive CSP.
 * `allow-same-origin` is only used to size the frame to its content; scripts cannot execute in the frame.
 */
export const SandboxedHtml: React.FC<{ html: string; title: string }> = ({ html, title }) => {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const srcDoc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; font-src https:"><base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#0f172a;margin:0;padding:4px}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:4px 8px}</style></head><body>${DOMPurify.sanitize(html, { FORBID_TAGS: ['script', 'iframe', 'form', 'object', 'embed'] })}</body></html>`, [html]);
  const resize = () => {
    const doc = frame.current?.contentDocument;
    if (doc?.documentElement) setHeight(Math.min(4000, Math.max(60, doc.documentElement.scrollHeight + 8)));
  };
  return <iframe ref={frame} title={title} srcDoc={srcDoc} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" onLoad={resize} className="w-full rounded-lg border border-slate-200 bg-white" style={{ height }} />;
};

const FileBlockView: React.FC<{ block: Extract<LessonBlock, { type: 'file' }> }> = ({ block }) => {
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  if (!block.asset) return <p className="text-xs text-rose-600">{t('blockUi.missingFile')}</p>;
  const asset = block.asset;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <span className="flex items-center gap-2 min-w-0">
        <FileText className="w-5 h-5 text-indigo-600 shrink-0" aria-hidden />
        <span className="min-w-0"><span className="font-semibold text-slate-800 block truncate">{block.title || asset.name}</span><span className="text-xs text-slate-500">{asset.name} · {formatBytes(asset.size)}</span></span>
      </span>
      <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
        onClick={() => { setError(false); downloadApiFile(asset.url, asset.name).catch(() => setError(true)); }}>
        <Download className="w-3.5 h-3.5" aria-hidden />{t('blockUi.download')}<span className="sr-only"> {asset.name}</span>
      </button>
      {error && <p role="alert" className="w-full text-xs text-rose-600">{t('blockUi.downloadError')}</p>}
    </div>
  );
};

/**
 * Mathematical formula: KaTeX output (MathML read by screen readers + visual HTML), `trust: false` (no links or external resources),
 * sanitized again with DOMPurify. The optional text alternative is exposed as a description.
 */
export const MathView: React.FC<{ latex: string; display?: 'block' | 'inline'; description?: string }> = ({ latex, display = 'block', description }) => {
  const { t } = useTranslation();
  const rendered = useMemo(() => {
    try {
      const html = katex.renderToString(latex, { displayMode: display === 'block', throwOnError: true, output: 'htmlAndMathml', trust: false, strict: 'ignore', maxSize: 20, maxExpand: 200 });
      return { html: DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true, svg: true } }), error: false };
    } catch { return { html: '', error: true }; }
  }, [latex, display]);
  if (rendered.error) return <p className="rounded bg-rose-50 p-2 font-mono text-xs text-rose-700" role="note">{t('blockUi.mathError')} <code>{latex}</code></p>;
  const Tag = display === 'block' ? 'div' : 'span';
  return (
    <figure className={display === 'block' ? 'my-2 overflow-x-auto' : 'inline'}>
      <Tag className="katex-host" dangerouslySetInnerHTML={{ __html: rendered.html }} />
      {description && <figcaption className="sr-only">{description}</figcaption>}
    </figure>
  );
};

/** Read-only rendering of lesson blocks, shared by the learner page, the student preview and the editor preview. */
export const LessonBlocksView: React.FC<{ blocks: LessonBlock[]; renderQuiz?: () => React.ReactNode; tone?: 'light' | 'dark' }> = ({ blocks, renderQuiz, tone = 'light' }) => {
  const { t, i18n } = useTranslation();
  const text = tone === 'dark' ? 'text-slate-200' : 'text-slate-800';
  return (
    <div className="space-y-6">
      {blocks.map(block => {
        switch (block.type) {
          case 'text': return <RichTextView key={block.id} html={block.html} className={text} />;
          case 'html': return <SandboxedHtml key={block.id} html={block.html} title={block.title || t('blockUi.htmlFrameTitle')} />;
          case 'code': return <CodeBlockView key={block.id} code={block.code} language={block.language} filename={block.filename} caption={block.caption} />;
          case 'divider': return <hr key={block.id} className="border-slate-300" />;
          case 'math': return <MathView key={block.id} latex={block.latex} display={block.display} description={block.description} />;
          case 'image': {
            const src = block.asset ? apiAssetUrl(block.asset.url) : block.url;
            if (!src) return <p key={block.id} className="text-xs text-rose-600">{t('blockUi.missingFile')}</p>;
            return (
              <figure key={block.id} className="space-y-2">
                <img src={src} alt={block.decorative ? '' : block.alt} loading="lazy" className="max-w-full h-auto rounded-lg border border-slate-200" />
                {block.caption && <figcaption className="text-xs text-slate-500">{block.caption}</figcaption>}
              </figure>
            );
          }
          case 'video': return (
            <figure key={block.id} className="space-y-2">
              {block.embedUrl ? (
                <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
                  <iframe src={block.embedUrl} title={block.title} className="h-full w-full" loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
                    allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" />
                </div>
              ) : block.asset ? (
                <video controls preload="metadata" crossOrigin="use-credentials" className="w-full rounded-xl bg-black" aria-label={block.title}>
                  <source src={apiAssetUrl(block.asset.url)} type={block.asset.mimeType} />
                  {block.captionsUrl && <track kind="captions" src={apiAssetUrl(block.captionsUrl)} srcLang={i18n.language.slice(0, 2)} label={t('blockUi.captions')} default />}
                </video>
              ) : <p className="text-xs text-rose-600">{t('blockUi.missingFile')}</p>}
              <figcaption className={`text-xs ${tone === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>{block.title}</figcaption>
              {block.transcript && (
                <details className={`text-xs ${text}`}>
                  <summary className="cursor-pointer font-semibold">{t('blockUi.transcript')}</summary>
                  <p className="mt-2 whitespace-pre-line">{block.transcript}</p>
                </details>
              )}
            </figure>
          );
          case 'file': return <FileBlockView key={block.id} block={block} />;
          case 'quiz': return <div key={block.id}>{renderQuiz ? renderQuiz() : (
            <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><HelpCircle className="w-4 h-4" aria-hidden />{t('blockUi.quizPlaceholder')}</p>
          )}</div>;
          default: return null;
        }
      })}
    </div>
  );
};
