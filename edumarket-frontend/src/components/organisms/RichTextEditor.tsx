import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';
import { Bold, Code, Heading2, Heading3, Italic, Link2, List, ListOrdered, Pilcrow, Quote, Redo2, RemoveFormatting, Table, Underline, Undo2 } from 'lucide-react';

/** Same allow-list as the server rich text policy: what the editor produces is what the API keeps. */
const ALLOWED_TAGS = ['h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'span'];
export const cleanRichText = (html: string) => DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan', 'scope'] });

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
/** Plain text → paragraphs (blank lines separate paragraphs, single newlines become <br>). */
export const textToHtml = (text: string) => text.split(/\r?\n\s*\r?\n/).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`).join('');

/**
 * WYSIWYG editor for text blocks (contentEditable + toolbar). The DOM is only rewritten when the value changes from outside,
 * so typing never moves the caret. Pasted content is reduced to the allowed tags.
 */
export const RichTextEditor: React.FC<{ value: string; onChange: (html: string) => void; label: string; id?: string }> = ({ value, onChange, label, id }) => {
  const { t } = useTranslation();
  const editor = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    if (editor.current && value !== lastEmitted.current) {
      editor.current.innerHTML = cleanRichText(value);
      lastEmitted.current = value;
    }
  }, [value]);

  const emit = () => {
    if (!editor.current) return;
    const html = editor.current.innerHTML;
    lastEmitted.current = html;
    onChange(html);
  };
  const run = (command: string, argument?: string) => {
    editor.current?.focus();
    document.execCommand(command, false, argument);
    emit();
  };
  const insertLink = () => {
    const url = window.prompt(t('blockUi.linkPrompt'), 'https://');
    if (!url) return;
    if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) { window.alert(t('blockUi.linkInvalid')); return; }
    run('createLink', url.trim());
  };
  const insertInlineCode = () => {
    const selection = window.getSelection()?.toString() || 'code';
    run('insertHTML', `<code>${escapeHtml(selection)}</code>&nbsp;`);
  };
  const insertTable = () => run('insertHTML', `<table><thead><tr><th scope="col">${escapeHtml(t('blockUi.tableHeader'))} 1</th><th scope="col">${escapeHtml(t('blockUi.tableHeader'))} 2</th></tr></thead><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p></p>`);
  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');
    document.execCommand('insertHTML', false, html ? cleanRichText(html) : textToHtml(text));
    emit();
  };

  const tools: Array<{ label: string; icon: React.ReactNode; action: () => void }> = [
    { label: t('blockUi.tools.paragraph'), icon: <Pilcrow className="w-4 h-4" />, action: () => run('formatBlock', 'p') },
    { label: t('blockUi.tools.heading2'), icon: <Heading2 className="w-4 h-4" />, action: () => run('formatBlock', 'h2') },
    { label: t('blockUi.tools.heading3'), icon: <Heading3 className="w-4 h-4" />, action: () => run('formatBlock', 'h3') },
    { label: t('blockUi.tools.bold'), icon: <Bold className="w-4 h-4" />, action: () => run('bold') },
    { label: t('blockUi.tools.italic'), icon: <Italic className="w-4 h-4" />, action: () => run('italic') },
    { label: t('blockUi.tools.underline'), icon: <Underline className="w-4 h-4" />, action: () => run('underline') },
    { label: t('blockUi.tools.bulletList'), icon: <List className="w-4 h-4" />, action: () => run('insertUnorderedList') },
    { label: t('blockUi.tools.numberedList'), icon: <ListOrdered className="w-4 h-4" />, action: () => run('insertOrderedList') },
    { label: t('blockUi.tools.quote'), icon: <Quote className="w-4 h-4" />, action: () => run('formatBlock', 'blockquote') },
    { label: t('blockUi.tools.inlineCode'), icon: <Code className="w-4 h-4" />, action: insertInlineCode },
    { label: t('blockUi.tools.link'), icon: <Link2 className="w-4 h-4" />, action: insertLink },
    { label: t('blockUi.tools.table'), icon: <Table className="w-4 h-4" />, action: insertTable },
    { label: t('blockUi.tools.clear'), icon: <RemoveFormatting className="w-4 h-4" />, action: () => run('removeFormat') },
    { label: t('blockUi.tools.undo'), icon: <Undo2 className="w-4 h-4" />, action: () => run('undo') },
    { label: t('blockUi.tools.redo'), icon: <Redo2 className="w-4 h-4" />, action: () => run('redo') },
  ];

  return (
    <div className="rounded-lg border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-indigo-500">
      <div role="toolbar" aria-label={t('blockUi.toolbar')} aria-controls={id} className="flex flex-wrap gap-0.5 border-b border-slate-200 p-1">
        {tools.map(tool => (
          <button key={tool.label} type="button" title={tool.label} aria-label={tool.label}
            onMouseDown={event => event.preventDefault()} onClick={tool.action}
            className="rounded p-1.5 text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">{tool.icon}</button>
        ))}
      </div>
      <div id={id} ref={editor} role="textbox" aria-multiline="true" aria-label={label} contentEditable suppressContentEditableWarning
        onInput={emit} onBlur={emit} onPaste={onPaste}
        className="lesson-rich-text min-h-[140px] p-3 text-slate-800 outline-none" />
    </div>
  );
};
