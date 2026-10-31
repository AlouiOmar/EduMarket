import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type Announcements, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, Code2, Copy, FileCode2, FileText, GripVertical, HelpCircle, Image, Minus, Paperclip, Plus, Sigma, Trash2, Type, Upload, Video } from 'lucide-react';
import { Input } from '../atoms/Input';
import { Select } from '../atoms/Select';
import { Textarea } from '../atoms/Textarea';
import { FormField } from '../molecules/FormField';
import { ConfirmationDialog } from '../molecules/ConfirmationDialog';
import { RichTextEditor, cleanRichText, textToHtml } from './RichTextEditor';
import { CodeBlockView, MathView, SandboxedHtml, formatBytes } from './LessonBlocksView';
import { apiAssetUrl } from '../../services/apiClient';
import type { UploadedAsset } from '../../services/courseContentService';
import type { CodeLanguage, LessonBlock, LessonBlockType } from '../../types';

export const CODE_LANGUAGES: CodeLanguage[] = ['typescript', 'html', 'javascript', 'css', 'scss', 'json', 'bash', 'python', 'java', 'sql', 'plaintext'];
const BLOCK_TYPES: LessonBlockType[] = ['text', 'code', 'math', 'image', 'video', 'file', 'html', 'quiz', 'divider'];
const BLOCK_ICONS: Record<LessonBlockType, React.ReactNode> = {
  text: <Type className="w-4 h-4" />, code: <Code2 className="w-4 h-4" />, image: <Image className="w-4 h-4" />, video: <Video className="w-4 h-4" />,
  file: <Paperclip className="w-4 h-4" />, html: <FileCode2 className="w-4 h-4" />, quiz: <HelpCircle className="w-4 h-4" />, divider: <Minus className="w-4 h-4" />, math: <Sigma className="w-4 h-4" />,
};
const newBlockId = () => `blk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function newBlock(type: LessonBlockType): LessonBlock {
  const id = newBlockId();
  switch (type) {
    case 'text': return { id, type, html: '' };
    case 'html': return { id, type, html: '', title: '' };
    case 'code': return { id, type, language: 'typescript', code: '', filename: '', caption: '' };
    case 'image': return { id, type, alt: '', decorative: false, caption: '' };
    case 'video': return { id, type, title: '', transcript: '' };
    case 'file': return { id, type, assetId: '', title: '' };
    case 'quiz': return { id, type };
    case 'divider': return { id, type };
    case 'math': return { id, type, latex: '', display: 'block', description: '' };
  }
}

/** Mirrors the API rules so authors see problems before an autosave is refused. Returns translation keys. */
export function blockIssues(blocks: LessonBlock[]): string[] {
  const issues = new Set<string>();
  for (const block of blocks) {
    if (block.type === 'image' && !block.assetId && !block.url) issues.add('blockUi.issues.imageSource');
    if (block.type === 'image' && !block.decorative && !block.alt.trim()) issues.add('blockUi.issues.imageAlt');
    if (block.type === 'image' && block.url && !block.url.startsWith('https://')) issues.add('blockUi.issues.https');
    if (block.type === 'video' && !block.assetId && !block.embedUrl) issues.add('blockUi.issues.videoSource');
    if (block.type === 'video' && !block.title.trim()) issues.add('blockUi.issues.videoTitle');
    if (block.type === 'file' && !block.assetId) issues.add('blockUi.issues.fileSource');
    if (block.type === 'math' && !block.latex.trim()) issues.add('blockUi.issues.mathLatex');
  }
  if (blocks.filter(block => block.type === 'quiz').length > 1) issues.add('blockUi.issues.singleQuiz');
  return [...issues];
}

type Upload = (kind: 'image' | 'block_video' | 'block_file' | 'caption', file: File) => Promise<UploadedAsset>;

const FileButton: React.FC<{ label: string; accept: string; busy: boolean; onFile: (file: File) => void }> = ({ label, accept, busy, onFile }) => (
  <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-indigo-500 ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
    <Upload className="w-3.5 h-3.5" aria-hidden />{label}
    <input type="file" className="sr-only" accept={accept} disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) onFile(file); event.target.value = ''; }} />
  </label>
);

/** Fields of one block. */
const BlockFields: React.FC<{ block: LessonBlock; onChange: (block: LessonBlock) => void; upload: Upload }> = ({ block, onChange, upload }) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (kind: Parameters<Upload>[0], file: File, apply: (asset: UploadedAsset) => void) => {
    setBusy(true); setError('');
    try { apply(await upload(kind, file)); }
    catch { setError(t('blockUi.uploadError')); }
    finally { setBusy(false); }
  };
  const assetOf = (asset: UploadedAsset) => ({ url: asset.url, name: asset.name, size: asset.size, mimeType: asset.type });
  const fieldId = (name: string) => `${block.id}-${name}`;

  const body = (() => {
    switch (block.type) {
      case 'text': return (
        <div className="space-y-2">
          <RichTextEditor id={fieldId('text')} label={t('blockUi.types.text')} value={block.html} onChange={html => onChange({ ...block, html })} />
          <FileButton label={t('blockUi.importFile')} accept=".html,.htm,.txt,text/html,text/plain" busy={busy} onFile={file => {
            if (file.size > 500_000) { setError(t('blockUi.importTooLarge')); return; }
            void file.text().then(content => onChange({ ...block, html: `${block.html}${/\.html?$/i.test(file.name) ? cleanRichText(content) : textToHtml(content)}` }));
          }} />
        </div>
      );
      case 'html': return (
        <div className="space-y-2">
          <FormField label={t('blockUi.htmlTitle')}><Input value={block.title || ''} maxLength={200} onChange={event => onChange({ ...block, title: event.target.value })} /></FormField>
          <FormField label={t('blockUi.types.html')} hint={t('blockUi.htmlHint')}>
            <Textarea rows={8} className="font-mono text-xs" spellCheck={false} value={block.html} maxLength={60000} onChange={event => onChange({ ...block, html: event.target.value })} />
          </FormField>
          {block.html.trim() && <SandboxedHtml html={block.html} title={block.title || t('blockUi.htmlFrameTitle')} />}
        </div>
      );
      case 'code': return (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <FormField label={t('blockUi.language')}>
              <Select value={block.language} onChange={event => onChange({ ...block, language: event.target.value as CodeLanguage })} options={CODE_LANGUAGES.map(value => ({ value, label: t(`blockUi.languages.${value}`) }))} />
            </FormField>
            <FormField label={t('blockUi.filename')}><Input value={block.filename || ''} maxLength={120} placeholder="app.component.ts" onChange={event => onChange({ ...block, filename: event.target.value })} /></FormField>
          </div>
          <FormField label={t('blockUi.types.code')}>
            <Textarea rows={8} className="font-mono text-xs" spellCheck={false} value={block.code} maxLength={20000} onChange={event => onChange({ ...block, code: event.target.value })} />
          </FormField>
          <FormField label={t('blockUi.caption')}><Input value={block.caption || ''} maxLength={300} onChange={event => onChange({ ...block, caption: event.target.value })} /></FormField>
          {block.code.trim() && <CodeBlockView code={block.code} language={block.language} filename={block.filename} caption={block.caption} />}
        </div>
      );
      case 'image': {
        const preview = block.asset ? apiAssetUrl(block.asset.url) : block.url;
        return (
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <FileButton label={busy ? t('blockUi.uploading') : t('blockUi.uploadImage')} accept="image/png,image/jpeg,image/webp,image/gif" busy={busy}
                onFile={file => void send('image', file, asset => onChange({ ...block, assetId: asset.id, url: undefined, asset: assetOf(asset) }))} />
              <span className="text-xs text-slate-500">{t('blockUi.or')}</span>
              <FormField label={t('blockUi.imageUrl')} className="flex-1 min-w-[200px]">
                <Input type="url" value={block.url || ''} placeholder="https://" maxLength={2000} onChange={event => onChange({ ...block, url: event.target.value || undefined, assetId: undefined, asset: undefined })} />
              </FormField>
            </div>
            <FormField label={t('blockUi.altText')} hint={t('blockUi.altHint')} required={!block.decorative}>
              <Input value={block.alt} maxLength={300} disabled={block.decorative} onChange={event => onChange({ ...block, alt: event.target.value })} />
            </FormField>
            <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={!!block.decorative} onChange={event => onChange({ ...block, decorative: event.target.checked })} />{t('blockUi.decorative')}</label>
            <FormField label={t('blockUi.caption')}><Input value={block.caption || ''} maxLength={300} onChange={event => onChange({ ...block, caption: event.target.value })} /></FormField>
            {preview && <img src={preview} alt={block.decorative ? '' : block.alt} className="max-h-48 rounded border border-slate-200" />}
          </div>
        );
      }
      case 'video': return (
        <div className="space-y-2">
          <FormField label={t('blockUi.videoTitle')} required><Input value={block.title} maxLength={200} onChange={event => onChange({ ...block, title: event.target.value })} /></FormField>
          <div className="flex flex-wrap items-end gap-2">
            <FileButton label={busy ? t('blockUi.uploading') : t('blockUi.uploadVideo')} accept="video/mp4,video/webm" busy={busy}
              onFile={file => void send('block_video', file, asset => onChange({ ...block, assetId: asset.id, embedUrl: undefined, asset: assetOf(asset) }))} />
            <span className="text-xs text-slate-500">{t('blockUi.or')}</span>
            <FormField label={t('blockUi.embedUrl')} hint={t('blockUi.embedHint')} className="flex-1 min-w-[200px]">
              <Input type="url" value={block.embedUrl || ''} placeholder="https://www.youtube.com/watch?v=…" maxLength={2000} onChange={event => onChange({ ...block, embedUrl: event.target.value || undefined, assetId: undefined, asset: undefined })} />
            </FormField>
          </div>
          {block.asset && <p className="text-xs text-slate-600">{block.asset.name} · {formatBytes(block.asset.size)}</p>}
          {block.assetId && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <FileButton label={t('blockUi.uploadCaptions')} accept=".vtt,text/vtt" busy={busy} onFile={file => void send('caption', file, asset => onChange({ ...block, captionsAssetId: asset.id, captionsUrl: asset.url }))} />
              {block.captionsAssetId && <span className="text-emerald-700">{t('blockUi.captionsReady')}</span>}
            </div>
          )}
          <FormField label={t('blockUi.transcript')}><Textarea rows={3} value={block.transcript || ''} maxLength={20000} onChange={event => onChange({ ...block, transcript: event.target.value })} /></FormField>
        </div>
      );
      case 'file': return (
        <div className="space-y-2">
          <FileButton label={busy ? t('blockUi.uploading') : block.assetId ? t('blockUi.replaceFile') : t('blockUi.uploadFile')} accept="application/pdf,application/zip,.pdf,.zip" busy={busy}
            onFile={file => void send('block_file', file, asset => onChange({ ...block, assetId: asset.id, title: block.title || asset.name, asset: assetOf(asset) }))} />
          {block.asset && <p className="text-xs text-slate-600">{block.asset.name} · {formatBytes(block.asset.size)}</p>}
          <FormField label={t('blockUi.fileTitle')}><Input value={block.title || ''} maxLength={200} onChange={event => onChange({ ...block, title: event.target.value })} /></FormField>
          <p className="text-[11px] text-slate-500">{t('blockUi.fileHint')}</p>
        </div>
      );
      case 'quiz': return <p className="text-xs text-slate-600">{t('blockUi.quizHint')}</p>;
      case 'divider': return <hr className="border-slate-300" />;
      case 'math': return (
        <div className="space-y-2">
          <FormField label={t('blockUi.mathLatex')} hint={t('blockUi.mathHint')}><Textarea rows={3} className="font-mono" value={block.latex} maxLength={4000} onChange={event => onChange({ ...block, latex: event.target.value })} /></FormField>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <FormField label={t('blockUi.mathDisplay')}><Select value={block.display} onChange={event => onChange({ ...block, display: event.target.value as 'block' | 'inline' })} options={[{ value: 'block', label: t('blockUi.mathBlock') }, { value: 'inline', label: t('blockUi.mathInline') }]} /></FormField>
            <FormField label={t('blockUi.mathDescription')} hint={t('blockUi.mathDescriptionHint')} className="sm:col-span-2"><Input value={block.description || ''} maxLength={500} onChange={event => onChange({ ...block, description: event.target.value })} /></FormField>
          </div>
          {block.latex.trim() && <div aria-label={t('blockUi.mathPreview')} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><MathView latex={block.latex} display={block.display} description={block.description} /></div>}
        </div>
      );
    }
  })();
  return <div className="space-y-2">{body}{error && <p role="alert" className="text-xs text-rose-600">{error}</p>}</div>;
};

const AddBlockMenu: React.FC<{ onAdd: (type: LessonBlockType) => void; label: string }> = ({ onAdd, label }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex justify-center">
      <button type="button" aria-expanded={open} aria-label={label} onClick={() => setOpen(value => !value)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 bg-white px-3 py-1 text-[11px] text-slate-500 hover:border-indigo-400 hover:text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">
        <Plus className="w-3 h-3" aria-hidden />{t('blockUi.addBlock')}
      </button>
      {open && (
        <div role="menu" aria-label={label} className="absolute top-8 z-20 grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg w-64"
          onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
          {BLOCK_TYPES.map(type => (
            <button key={type} role="menuitem" type="button" className="flex items-center gap-2 rounded px-2 py-1.5 text-start text-xs text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
              onClick={() => { onAdd(type); setOpen(false); }}>{BLOCK_ICONS[type]}{t(`blockUi.types.${type}`)}</button>
          ))}
        </div>
      )}
    </div>
  );
};

const SortableBlock: React.FC<{
  block: LessonBlock; index: number; count: number; onChange: (block: LessonBlock) => void; onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void; onDelete: () => void; upload: Upload;
}> = ({ block, index, count, onChange, onMove, onDuplicate, onDelete, upload }) => {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const typeLabel = t(`blockUi.types.${block.type}`);
  const iconButton = 'rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500';
  return (
    <section ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} aria-label={t('blockUi.blockPosition', { type: typeLabel, position: index + 1, count })}
      className={`rounded-xl border bg-white p-3 shadow-xs ${isDragging ? 'border-indigo-400 ring-2 ring-indigo-200 opacity-80 z-10 relative' : 'border-slate-200'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={t('blockUi.dragHandle', { type: typeLabel, position: index + 1 })}
            className={`${iconButton} cursor-grab touch-none active:cursor-grabbing`}><GripVertical className="w-4 h-4" /></button>
          {BLOCK_ICONS[block.type]}<span>{typeLabel}</span>
        </div>
        <div className="flex items-center">
          <button type="button" className={iconButton} disabled={index === 0} onClick={() => onMove(-1)} aria-label={t('blockUi.moveUp', { type: typeLabel, position: index + 1 })}><ArrowUp className="w-4 h-4" /></button>
          <button type="button" className={iconButton} disabled={index === count - 1} onClick={() => onMove(1)} aria-label={t('blockUi.moveDown', { type: typeLabel, position: index + 1 })}><ArrowDown className="w-4 h-4" /></button>
          <button type="button" className={iconButton} onClick={onDuplicate} aria-label={t('blockUi.duplicate', { type: typeLabel, position: index + 1 })}><Copy className="w-4 h-4" /></button>
          <button type="button" className={`${iconButton} hover:text-rose-600`} onClick={onDelete} aria-label={t('blockUi.delete', { type: typeLabel, position: index + 1 })}><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
      <BlockFields block={block} onChange={onChange} upload={upload} />
    </section>
  );
};

/** Ordered list of blocks of one item. Changes are reported to the parent, which persists them (autosave). */
export const LessonBlockEditor: React.FC<{ blocks: LessonBlock[]; onChange: (blocks: LessonBlock[]) => void; upload: Upload }> = ({ blocks, onChange, upload }) => {
  const { t } = useTranslation();
  const [pendingDelete, setPendingDelete] = useState<LessonBlock | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const label = (id: string | number) => { const index = blocks.findIndex(block => block.id === id); return index < 0 ? '' : t('blockUi.blockPosition', { type: t(`blockUi.types.${blocks[index].type}`), position: index + 1, count: blocks.length }); };
  const announcements: Announcements = useMemo(() => ({
    onDragStart: ({ active }) => t('blockUi.dnd.start', { item: label(active.id) }),
    onDragOver: ({ over }) => over ? t('blockUi.dnd.over', { position: blocks.findIndex(block => block.id === over.id) + 1 }) : '',
    onDragEnd: ({ over }) => over ? t('blockUi.dnd.end', { position: blocks.findIndex(block => block.id === over.id) + 1 }) : t('blockUi.dnd.cancel'),
    onDragCancel: () => t('blockUi.dnd.cancel'),
  }), [blocks, t]);

  const insertAt = (index: number, type: LessonBlockType) => {
    if (type === 'quiz' && blocks.some(block => block.type === 'quiz')) { setAnnouncement(t('blockUi.issues.singleQuiz')); return; }
    const next = [...blocks]; next.splice(index, 0, newBlock(type)); onChange(next);
    setAnnouncement(t('blockUi.added', { type: t(`blockUi.types.${type}`), position: index + 1 }));
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length) return;
    onChange(arrayMove(blocks, from, to));
    setAnnouncement(t('blockUi.moved', { type: t(`blockUi.types.${blocks[from].type}`), position: to + 1 }));
  };
  const duplicate = (index: number) => {
    const source = blocks[index];
    if (source.type === 'quiz') { setAnnouncement(t('blockUi.issues.singleQuiz')); return; }
    const next = [...blocks]; next.splice(index + 1, 0, { ...JSON.parse(JSON.stringify(source)), id: newBlockId() }); onChange(next);
    setAnnouncement(t('blockUi.duplicated', { position: index + 2 }));
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(blocks.findIndex(block => block.id === active.id), blocks.findIndex(block => block.id === over.id));
  };

  return (
    <div className="space-y-2">
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <AddBlockMenu label={t('blockUi.addBlockAt', { position: 1 })} onAdd={type => insertAt(0, type)} />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}
        accessibility={{ announcements, screenReaderInstructions: { draggable: t('blockUi.dnd.instructions') } }}>
        <SortableContext items={blocks.map(block => block.id)} strategy={verticalListSortingStrategy}>
          {blocks.map((block, index) => (
            <React.Fragment key={block.id}>
              <SortableBlock block={block} index={index} count={blocks.length} upload={upload}
                onChange={changed => onChange(blocks.map(item => item.id === block.id ? changed : item))}
                onMove={delta => move(index, index + delta)} onDuplicate={() => duplicate(index)} onDelete={() => setPendingDelete(block)} />
              <AddBlockMenu label={t('blockUi.addBlockAt', { position: index + 2 })} onAdd={type => insertAt(index + 1, type)} />
            </React.Fragment>
          ))}
        </SortableContext>
      </DndContext>
      {blocks.length === 0 && <p className="flex items-center justify-center gap-2 text-xs text-slate-500"><FileText className="w-4 h-4" aria-hidden />{t('blockUi.empty')}</p>}
      <ConfirmationDialog isOpen={!!pendingDelete} isDangerous title={t('blockUi.deleteTitle')} description={t('blockUi.deleteDescription', { type: pendingDelete ? t(`blockUi.types.${pendingDelete.type}`) : '' })}
        confirmLabel={t('blockUi.deleteConfirm')} onCancel={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) { onChange(blocks.filter(block => block.id !== pendingDelete.id)); setAnnouncement(t('blockUi.deleted')); } setPendingDelete(null); }} />
    </div>
  );
};
