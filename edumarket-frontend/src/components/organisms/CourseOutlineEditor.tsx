import React, { useEffect, useMemo, useRef, useState } from 'react';
import { integrationApi } from '../../services/integrationService';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, pointerWithin, useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type KeyboardCoordinateGetter, type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown, ArrowUp, CalendarClock, ChevronDown, ChevronRight, Copy, Eye, EyeOff, FileText, Folder, GripVertical, Layers, Link2, ListOrdered,
  Lock, MoreHorizontal, MoveRight, Pencil, Plus, Search, Trash2, Video,
 Package, Plug } from 'lucide-react';
import { Button } from '../atoms/Button';
import { Badge } from '../atoms/Badge';
import { Input } from '../atoms/Input';
import { Select } from '../atoms/Select';
import { Switch } from '../atoms/Switch';
import { Textarea } from '../atoms/Textarea';
import { FormField } from '../molecules/FormField';
import { ConfirmationDialog } from '../molecules/ConfirmationDialog';
import { ErrorAlert } from '../molecules/PageStates';
import { courseContentApi, errorCode, type MoveRequest, type Outline } from '../../services/courseContentService';
import { apiAssetUrl } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';
import { applyMove, fromLocalInput, publicationState, toLocalInput } from '../../utils/outline';
import type { ContentVisibility, CourseChapter, CourseLesson } from '../../types';

type DragData = { type: 'container'; id: string } | { type: 'item'; id: string; containerId: string } | { type: 'body'; containerId: string };
type Creating = { kind: 'container'; index: number } | { kind: 'item'; containerId: string; index: number };

const ITEM_ICONS: Record<CourseLesson['type'], React.ReactNode> = {
  text: <FileText className="w-4 h-4 text-emerald-600" aria-hidden />, video: <Video className="w-4 h-4 text-indigo-600" aria-hidden />,
  link: <Link2 className="w-4 h-4 text-sky-600" aria-hidden />, interactive: <Layers className="w-4 h-4 text-amber-600" aria-hidden />,
  lti: <Plug className="w-4 h-4 text-violet-600" aria-hidden />, scorm: <Package className="w-4 h-4 text-rose-600" aria-hidden />,
};
/** Targets a dragged element may land on: containers among containers; items among items and container bodies. */
const acceptsDrop = (active: DragData | undefined, candidate: DragData | undefined) =>
  active?.type === 'container' ? candidate?.type === 'container' : candidate?.type === 'item' || candidate?.type === 'body';

/**
 * Keyboard moves only consider targets of the dragged type: module cards contain their items, so the stock getter would
 * otherwise aim at an item nested in the module being moved.
 */
const typedKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const all = args.context.droppableContainers;
  const active = args.context.active?.data.current as DragData | undefined;
  const droppableContainers = { getEnabled: () => all.getEnabled().filter(entry => acceptsDrop(active, entry.data.current as DragData | undefined)), get: (id: UniqueIdentifier) => all.get(id) } as typeof all;
  return sortableKeyboardCoordinates(event, { ...args, context: { ...args.context, droppableContainers } });
};

const iconButton = 'rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500';

/** Publication badge shared by containers and items. */
const PublicationBadge: React.FC<{ entity: { visibility?: string; availableFrom?: string | null; availableUntil?: string | null } }> = ({ entity }) => {
  const { t, i18n } = useTranslation();
  const state = publicationState(entity);
  if (state === 'visible') return entity.availableUntil ? <Badge size="sm" variant="info">{t('courseContentUi.until', { date: formatDateTime(entity.availableUntil, i18n.language) })}</Badge> : null;
  if (state === 'scheduled') return <Badge size="sm" variant="purple"><CalendarClock className="w-3 h-3 inline me-1" aria-hidden />{t('courseContentUi.scheduled', { date: formatDateTime(entity.availableFrom!, i18n.language) })}</Badge>;
  if (state === 'expired') return <Badge size="sm" variant="warning">{t('courseContentUi.expired')}</Badge>;
  return null;
};

/** Authoring state of an item: unpublished changes or a planned publication (students still see the published version). */
const DraftBadge: React.FC<{ item: CourseLesson }> = ({ item }) => {
  const { t, i18n } = useTranslation();
  if (item.scheduledPublishAt) return <Badge size="sm" variant="purple">{t('publicationUi.badgeScheduled', { date: formatDateTime(item.scheduledPublishAt, i18n.language) })}</Badge>;
  if (item.publicationStatus === 'pending_changes') return <Badge size="sm" variant="warning">{t('publicationUi.status.pending_changes')}</Badge>;
  return null;
};

const VisibilitySelect: React.FC<{ value?: ContentVisibility; label: string; disabled: boolean; onChange: (value: ContentVisibility) => void }> = ({ value, label, disabled, onChange }) => {
  const { t } = useTranslation();
  const hidden = value === 'hidden';
  return (
    <label className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${hidden ? 'border-slate-300 bg-slate-100 text-slate-600' : 'border-emerald-300 bg-emerald-50 text-emerald-800'}`}>
      {hidden ? <EyeOff className="w-3 h-3" aria-hidden /> : <Eye className="w-3 h-3" aria-hidden />}
      <span className="sr-only">{label}</span>
      <select className="bg-transparent outline-none cursor-pointer" value={hidden ? 'hidden' : 'visible'} disabled={disabled} onChange={event => onChange(event.target.value as ContentVisibility)}>
        <option value="hidden">{t('courseContentUi.hidden')}</option>
        <option value="visible">{t('courseContentUi.visible')}</option>
      </select>
    </label>
  );
};

/** "Plus d'options" menu (disclosure pattern, closes on Escape and outside click). */
const MoreMenu: React.FC<{ label: string; actions: Array<{ label: string; icon: React.ReactNode; onSelect: () => void; disabled?: boolean; danger?: boolean }> }> = ({ label, actions }) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={root} className="relative" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus(); } }}>
      <button type="button" className={iconButton} aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(value => !value)}><MoreHorizontal className="w-4 h-4" /></button>
      {open && (
        <div role="menu" aria-label={label} className="absolute end-0 top-8 z-30 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {actions.map(action => (
            <button key={action.label} role="menuitem" type="button" disabled={action.disabled}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-xs hover:bg-slate-100 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${action.danger ? 'text-rose-600' : 'text-slate-700'}`}
              onClick={() => { setOpen(false); action.onSelect(); }}>{action.icon}{action.label}</button>
          ))}
        </div>
      )}
    </div>
  );
};

/** Accessible "Déplacer vers…" dialog: destination container (items) and position, without any pointer interaction. */
const MoveDialog: React.FC<{ chapters: CourseChapter[]; target: { type: 'container' | 'item'; id: string }; onCancel: () => void; onConfirm: (move: MoveRequest) => void }> = ({ chapters, target, onCancel, onConfirm }) => {
  const { t } = useTranslation();
  const sourceChapter = target.type === 'item' ? chapters.find(chapter => chapter.lessons.some(lesson => lesson.id === target.id)) : undefined;
  const [containerId, setContainerId] = useState(sourceChapter?.id || '');
  const siblings = target.type === 'container' ? chapters.filter(chapter => chapter.id !== target.id) : (chapters.find(chapter => chapter.id === containerId)?.lessons || []).filter(lesson => lesson.id !== target.id);
  const currentIndex = target.type === 'container' ? chapters.findIndex(chapter => chapter.id === target.id) : (sourceChapter?.lessons.findIndex(lesson => lesson.id === target.id) ?? 0);
  const [position, setPosition] = useState(containerId === sourceChapter?.id || target.type === 'container' ? currentIndex : 0);
  useEffect(() => { if (target.type === 'item') setPosition(containerId === sourceChapter?.id ? currentIndex : siblings.length); }, [containerId]);
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const title = target.type === 'container' ? chapters.find(chapter => chapter.id === target.id)?.title : sourceChapter?.lessons.find(lesson => lesson.id === target.id)?.title;
  const options = [{ value: '0', label: t('courseContentUi.positionFirst') }, ...siblings.map((sibling, index) => ({ value: String(index + 1), label: t('courseContentUi.positionAfter', { title: sibling.title }) }))];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onKeyDown={event => { if (event.key === 'Escape') onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="move-dialog-title" className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <h2 id="move-dialog-title" className="text-base font-semibold text-slate-900">{t('courseContentUi.moveTitle', { title })}</h2>
        {target.type === 'item' && (
          <FormField label={t('courseContentUi.moveDestination')}>
            <Select ref={first} value={containerId} onChange={event => setContainerId(event.target.value)} options={chapters.map(chapter => ({ value: chapter.id, label: chapter.title }))} />
          </FormField>
        )}
        <FormField label={t('courseContentUi.movePosition')}>
          <Select ref={target.type === 'container' ? first : undefined} value={String(position)} onChange={event => setPosition(Number(event.target.value))} options={options} />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>{t('platformCommon.cancel')}</Button>
          <Button size="sm" onClick={() => onConfirm(target.type === 'container' ? { type: 'container', id: target.id, toIndex: position } : { type: 'item', id: target.id, toContainerId: containerId, toIndex: position })}>{t('courseContentUi.moveConfirm')}</Button>
        </div>
      </div>
    </div>
  );
};

type CreateInput = { title: string; kind?: 'module' | 'folder'; type?: CourseLesson['type']; url?: string; ltiToolId?: string; scormPackageId?: string };
const CreateForm: React.FC<{ courseId: string; creating: Creating; onCancel: () => void; onSubmit: (input: CreateInput) => void; busy: boolean }> = ({ courseId, creating, onCancel, onSubmit, busy }) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'module' | 'folder'>('module');
  const [type, setType] = useState<CourseLesson['type']>('text');
  const [url, setUrl] = useState('https://');
  // LTI tools (registered by an administrator) and SCORM packages (imported in the course) are loaded when the type is chosen.
  const [tools, setTools] = useState<{ id: string; name: string }[] | null>(null);
  const [packages, setPackages] = useState<{ id: string; title: string }[] | null>(null);
  const [reference, setReference] = useState('');
  useEffect(() => {
    if (type === 'lti' && !tools) integrationApi.availableTools().then(result => { setTools(result.tools); setReference(result.tools[0]?.id || ''); }).catch(() => setTools([]));
    if (type === 'scorm' && !packages) integrationApi.scormPackages(courseId).then(result => { setPackages(result.packages); setReference(result.packages[0]?.id || ''); }).catch(() => setPackages([]));
  }, [type]);
  const missingReference = creating.kind === 'item' && (type === 'lti' || type === 'scorm') && !reference;
  return (
    <form className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4" aria-label={t('courseContentUi.createTitle')}
      onSubmit={event => { event.preventDefault(); onSubmit(creating.kind === 'container' ? { title: title.trim(), kind } : { title: title.trim(), type, ...(type === 'link' ? { url: url.trim() } : {}), ...(type === 'lti' ? { ltiToolId: reference } : {}), ...(type === 'scorm' ? { scormPackageId: reference } : {}) }); }}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {creating.kind === 'container' ? (
          <FormField label={t('courseContentUi.elementType')}>
            <Select value={kind} onChange={event => setKind(event.target.value as 'module' | 'folder')} options={[{ value: 'module', label: t('courseContentUi.kinds.module') }, { value: 'folder', label: t('courseContentUi.kinds.folder') }]} />
          </FormField>
        ) : (
          <FormField label={t('courseContentUi.elementType')}>
            <Select value={type} onChange={event => setType(event.target.value as CourseLesson['type'])} options={[{ value: 'text', label: t('courseContentUi.itemTypes.text') }, { value: 'link', label: t('courseContentUi.itemTypes.link') }, { value: 'lti', label: t('integrationUi.itemTypes.lti') }, { value: 'scorm', label: t('integrationUi.itemTypes.scorm') }]} />
          </FormField>
        )}
        <FormField label={t('courseContentUi.title')} required className="sm:col-span-2"><Input autoFocus value={title} maxLength={240} required onChange={event => setTitle(event.target.value)} /></FormField>
      </div>
      {creating.kind === 'item' && type === 'lti' && (tools && !tools.length ? <p className="text-xs text-amber-800">{t('integrationUi.noTools')}</p> : (
        <FormField label={t('integrationUi.tool')} required><Select value={reference} onChange={event => setReference(event.target.value)} options={(tools || []).map(tool => ({ value: tool.id, label: tool.name }))} /></FormField>
      ))}
      {creating.kind === 'item' && type === 'scorm' && (packages && !packages.length ? <p className="text-xs text-amber-800">{t('integrationUi.noPackages')}</p> : (
        <FormField label={t('integrationUi.package')} required><Select value={reference} onChange={event => setReference(event.target.value)} options={(packages || []).map(row => ({ value: row.id, label: row.title }))} /></FormField>
      ))}
      {creating.kind === 'item' && type === 'link' && (
        <FormField label={t('courseContentUi.linkUrl')} required><Input type="url" value={url} maxLength={2000} required onChange={event => setUrl(event.target.value)} /></FormField>
      )}
      <p className="text-[11px] text-slate-500">{t('courseContentUi.createdHidden')}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>{t('platformCommon.cancel')}</Button>
        <Button type="submit" size="sm" isLoading={busy} disabled={!title.trim() || missingReference}>{t('courseContentUi.create')}</Button>
      </div>
    </form>
  );
};

const Inserter: React.FC<{ label: string; onClick: () => void; disabled: boolean }> = ({ label, onClick, disabled }) => (
  <div className="group flex items-center gap-2 py-0.5">
    <span className="h-px flex-1 bg-transparent group-hover:bg-indigo-200 group-focus-within:bg-indigo-200" />
    <button type="button" disabled={disabled} onClick={onClick} aria-label={label} title={label}
      className="rounded-full border border-slate-200 bg-white p-0.5 text-slate-400 opacity-60 hover:text-indigo-600 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:hidden"><Plus className="w-3.5 h-3.5" /></button>
    <span className="h-px flex-1 bg-transparent group-hover:bg-indigo-200 group-focus-within:bg-indigo-200" />
  </div>
);

const ContainerSettings: React.FC<{ courseId: string; chapter: CourseChapter; busy: boolean; onSave: (patch: Parameters<typeof courseContentApi.updateContainer>[2]) => void; onCancel: () => void }> = ({ courseId, chapter, busy, onSave, onCancel }) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState(chapter.title);
  const [description, setDescription] = useState(chapter.description || '');
  const [kind, setKind] = useState(chapter.kind || 'module');
  const [sequential, setSequential] = useState(!!chapter.sequential);
  const [from, setFrom] = useState(toLocalInput(chapter.availableFrom));
  const [until, setUntil] = useState(toLocalInput(chapter.availableUntil));
  const [thumbnail, setThumbnail] = useState({ assetId: chapter.thumbnail?.assetId || '', alt: chapter.thumbnail?.alt || '', url: chapter.thumbnailUrl || '' });
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const invalidWindow = !!from && !!until && new Date(from) >= new Date(until);
  return (
    <form className="mt-3 space-y-3 border-t border-slate-100 pt-3" onSubmit={event => {
      event.preventDefault();
      onSave({ title: title.trim(), description, kind, sequential: kind === 'module' && sequential, availableFrom: fromLocalInput(from), availableUntil: fromLocalInput(until), thumbnail: { assetId: thumbnail.assetId, alt: thumbnail.alt.trim() } });
    }}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FormField label={t('courseContentUi.title')} required className="sm:col-span-2"><Input value={title} maxLength={240} required onChange={event => setTitle(event.target.value)} /></FormField>
        <FormField label={t('courseContentUi.elementType')}>
          <Select value={kind} onChange={event => setKind(event.target.value as 'module' | 'folder')} options={[{ value: 'module', label: t('courseContentUi.kinds.module') }, { value: 'folder', label: t('courseContentUi.kinds.folder') }]} />
        </FormField>
      </div>
      <FormField label={t('courseContentUi.description')} hint={t('courseContentUi.descriptionHint')}><Textarea rows={3} maxLength={4000} value={description} onChange={event => setDescription(event.target.value)} /></FormField>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label={t('courseContentUi.availableFrom')}><Input type="datetime-local" value={from} onChange={event => setFrom(event.target.value)} /></FormField>
        <FormField label={t('courseContentUi.availableUntil')} error={invalidWindow ? t('courseContentUi.invalidWindow') : undefined}><Input type="datetime-local" value={until} onChange={event => setUntil(event.target.value)} /></FormField>
      </div>
      {kind === 'module' && (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span><span className="font-semibold text-slate-800 block">{t('courseContentUi.sequential')}</span><span className="text-slate-500">{t('courseContentUi.sequentialHint')}</span></span>
          <Switch checked={sequential} onChange={setSequential} ariaLabel={t('courseContentUi.sequential')} />
        </div>
      )}
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-slate-800">{t('courseContentUi.thumbnail')}</legend>
        <div className="flex flex-wrap items-center gap-3">
          {thumbnail.url && <img src={apiAssetUrl(thumbnail.url)} alt="" className="h-12 w-20 rounded object-cover border border-slate-200" />}
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-indigo-500">
            {uploading ? t('blockUi.uploading') : t('courseContentUi.uploadThumbnail')}
            <input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading} onChange={event => {
              const file = event.target.files?.[0]; event.target.value = '';
              if (!file) return;
              setUploading(true); setUploadError('');
              courseContentApi.uploadMedia(courseId, 'image', file).then(asset => setThumbnail(value => ({ ...value, assetId: asset.id, url: asset.url }))).catch(() => setUploadError(t('blockUi.uploadError'))).finally(() => setUploading(false));
            }} />
          </label>
          {thumbnail.assetId && <Button type="button" variant="ghost" size="sm" onClick={() => setThumbnail({ assetId: '', alt: '', url: '' })}>{t('courseContentUi.removeThumbnail')}</Button>}
        </div>
        {thumbnail.assetId && <FormField label={t('blockUi.altText')} required><Input value={thumbnail.alt} maxLength={300} required onChange={event => setThumbnail(value => ({ ...value, alt: event.target.value }))} /></FormField>}
        {uploadError && <p role="alert" className="text-xs text-rose-600">{uploadError}</p>}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>{t('platformCommon.cancel')}</Button>
        <Button type="submit" size="sm" isLoading={busy} disabled={!title.trim() || invalidWindow || uploading}>{t('courseContentUi.save')}</Button>
      </div>
    </form>
  );
};

/** One item row (sortable via its handle only, so edit/delete buttons never start a drag). */
const ItemRow: React.FC<{
  courseId: string; item: CourseLesson; index: number; chapter: CourseChapter; chapterIndex: number; chapters: CourseChapter[]; busy: boolean; dragDisabled: boolean;
  selected: boolean; onSelect: (checked: boolean) => void; onVisibility: (value: ContentVisibility) => void; onMove: (move: MoveRequest) => void;
  onMoveDialog: () => void; onDuplicate: () => void; onDelete: () => void; dropBefore: boolean;
}> = ({ courseId, item, index, chapter, chapterIndex, chapters, busy, dragDisabled, selected, onSelect, onVisibility, onMove, onMoveDialog, onDuplicate, onDelete, dropBefore }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `i:${item.id}`, data: { type: 'item', id: item.id, containerId: chapter.id } satisfies DragData, disabled: dragDisabled });
  const last = index === chapter.lessons.length - 1;
  const previous = chapters[chapterIndex - 1], next = chapters[chapterIndex + 1];
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`relative ${isDragging ? 'opacity-40' : ''}`}>
      {dropBefore && <span className="absolute -top-1 inset-x-0 h-0.5 rounded bg-indigo-500" aria-hidden />}
      <div className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${selected ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
        <input type="checkbox" checked={selected} onChange={event => onSelect(event.target.checked)} aria-label={t('courseContentUi.select', { title: item.title })} />
        <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={dragDisabled} aria-label={t('courseContentUi.dragHandle', { title: item.title, position: index + 1, container: chapter.title })}
          className={`${iconButton} cursor-grab touch-none active:cursor-grabbing`}><GripVertical className="w-4 h-4" /></button>
        {ITEM_ICONS[item.type] ?? ITEM_ICONS.text}
        <Link to={`/teacher/courses/${courseId}/content/items/${item.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:text-indigo-700 hover:underline">{item.title}</Link>
        <span className="hidden sm:inline-flex items-center gap-1"><PublicationBadge entity={item} /><DraftBadge item={item} /></span>
        <VisibilitySelect value={item.visibility} disabled={busy} label={t('courseContentUi.visibilityOf', { title: item.title })} onChange={onVisibility} />
        <button type="button" className={`${iconButton} hidden sm:inline-flex`} disabled={busy || (index === 0 && !previous)} aria-label={t('courseContentUi.moveUp', { title: item.title })}
          onClick={() => onMove(index > 0 ? { type: 'item', id: item.id, toContainerId: chapter.id, toIndex: index - 1 } : { type: 'item', id: item.id, toContainerId: previous!.id, toIndex: previous!.lessons.length })}><ArrowUp className="w-4 h-4" /></button>
        <button type="button" className={`${iconButton} hidden sm:inline-flex`} disabled={busy || (last && !next)} aria-label={t('courseContentUi.moveDown', { title: item.title })}
          onClick={() => onMove(!last ? { type: 'item', id: item.id, toContainerId: chapter.id, toIndex: index + 1 } : { type: 'item', id: item.id, toContainerId: next!.id, toIndex: 0 })}><ArrowDown className="w-4 h-4" /></button>
        <MoreMenu label={t('courseContentUi.moreOptions', { title: item.title })} actions={[
          { label: t('courseContentUi.edit'), icon: <Pencil className="w-3.5 h-3.5" />, onSelect: () => navigate(`/teacher/courses/${courseId}/content/items/${item.id}`) },
          { label: t('courseContentUi.moveTo'), icon: <MoveRight className="w-3.5 h-3.5" />, onSelect: onMoveDialog, disabled: busy },
          { label: t('courseContentUi.duplicate'), icon: <Copy className="w-3.5 h-3.5" />, onSelect: onDuplicate, disabled: busy },
          { label: t('courseContentUi.delete'), icon: <Trash2 className="w-3.5 h-3.5" />, onSelect: onDelete, disabled: busy, danger: true },
        ]} />
      </div>
    </li>
  );
};

const ContainerDropZone: React.FC<{ chapter: CourseChapter; active: boolean; children: React.ReactNode }> = ({ chapter, active, children }) => {
  const { setNodeRef } = useDroppable({ id: `d:${chapter.id}`, data: { type: 'body', containerId: chapter.id } satisfies DragData });
  return <div ref={setNodeRef} className={`rounded-lg transition-colors ${active ? 'bg-indigo-50 ring-2 ring-indigo-300' : ''}`}>{children}</div>;
};

const ContainerCard: React.FC<{
  chapter: CourseChapter; index: number; count: number; dragDisabled: boolean; expanded: boolean; onToggle: () => void; busy: boolean;
  selected: boolean; onSelect: (checked: boolean) => void; onVisibility: (value: ContentVisibility) => void; onMove: (toIndex: number) => void;
  onMoveDialog: () => void; onDuplicate: () => void; onDelete: () => void; onEdit: () => void; children: React.ReactNode;
}> = ({ chapter, index, count, dragDisabled, expanded, onToggle, busy, selected, onSelect, onVisibility, onMove, onMoveDialog, onDuplicate, onDelete, onEdit, children }) => {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `c:${chapter.id}`, data: { type: 'container', id: chapter.id } satisfies DragData, disabled: dragDisabled });
  const bodyId = `container-body-${chapter.id}`;
  return (
    <section ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} aria-labelledby={`container-title-${chapter.id}`}
      className={`rounded-xl border bg-white p-3 shadow-xs ${isDragging ? 'opacity-40' : ''} ${chapter.visibility === 'hidden' ? 'border-slate-200' : 'border-emerald-200'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="checkbox" checked={selected} onChange={event => onSelect(event.target.checked)} aria-label={t('courseContentUi.select', { title: chapter.title })} />
        <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={dragDisabled} aria-label={t('courseContentUi.dragHandleContainer', { title: chapter.title, position: index + 1, count })}
          className={`${iconButton} cursor-grab touch-none active:cursor-grabbing`}><GripVertical className="w-4 h-4" /></button>
        {chapter.thumbnailUrl && <img src={apiAssetUrl(chapter.thumbnailUrl)} alt={chapter.thumbnail?.alt || ''} className="hidden sm:block h-10 w-16 rounded object-cover" />}
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={bodyId} className="flex min-w-0 flex-1 items-center gap-2 text-start">
          {expanded ? <ChevronDown className="w-4 h-4 shrink-0 text-slate-400" aria-hidden /> : <ChevronRight className="w-4 h-4 shrink-0 text-slate-400 rtl-flip" aria-hidden />}
          {chapter.kind === 'folder' ? <Folder className="w-4 h-4 shrink-0 text-amber-600" aria-hidden /> : <ListOrdered className="w-4 h-4 shrink-0 text-indigo-600" aria-hidden />}
          <h2 id={`container-title-${chapter.id}`} className="truncate text-sm font-bold text-slate-900">{chapter.title}</h2>
          <span className="shrink-0 text-[11px] text-slate-500">{t('courseContentUi.itemCount', { count: chapter.lessons.length })}</span>
        </button>
        <Badge size="sm" variant={chapter.kind === 'folder' ? 'warning' : 'info'}>{t(`courseContentUi.kinds.${chapter.kind || 'module'}`)}</Badge>
        {chapter.sequential && <Badge size="sm" variant="purple"><Lock className="w-3 h-3 inline me-1" aria-hidden />{t('courseContentUi.sequentialBadge')}</Badge>}
        <PublicationBadge entity={chapter} />
        <VisibilitySelect value={chapter.visibility} disabled={busy} label={t('courseContentUi.visibilityOf', { title: chapter.title })} onChange={onVisibility} />
        <button type="button" className={iconButton} disabled={busy || index === 0} onClick={() => onMove(index - 1)} aria-label={t('courseContentUi.moveUp', { title: chapter.title })}><ArrowUp className="w-4 h-4" /></button>
        <button type="button" className={iconButton} disabled={busy || index === count - 1} onClick={() => onMove(index + 1)} aria-label={t('courseContentUi.moveDown', { title: chapter.title })}><ArrowDown className="w-4 h-4" /></button>
        <MoreMenu label={t('courseContentUi.moreOptions', { title: chapter.title })} actions={[
          { label: t('courseContentUi.settings'), icon: <Pencil className="w-3.5 h-3.5" />, onSelect: onEdit },
          { label: t('courseContentUi.moveTo'), icon: <MoveRight className="w-3.5 h-3.5" />, onSelect: onMoveDialog, disabled: busy },
          { label: t('courseContentUi.duplicate'), icon: <Copy className="w-3.5 h-3.5" />, onSelect: onDuplicate, disabled: busy },
          { label: t('courseContentUi.delete'), icon: <Trash2 className="w-3.5 h-3.5" />, onSelect: onDelete, disabled: busy, danger: true },
        ]} />
      </div>
      {chapter.description && <p className="mt-1 ps-16 text-xs text-slate-500 line-clamp-2">{chapter.description}</p>}
      <div id={bodyId} hidden={!expanded} className="mt-2 ps-4 sm:ps-8">{children}</div>
    </section>
  );
};

/**
 * Teacher outline of a course ("Contenu du cours"). Every change is sent to the API at once; the UI updates optimistically
 * and goes back to the previous state when the server refuses (network error, permission, conflict).
 */
export const CourseOutlineEditor: React.FC<{ courseId: string; outline: Outline; onOutline: (outline: Outline) => void; onReload: () => void }> = ({ courseId, outline, onOutline, onReload }) => {
  const { t } = useTranslation();
  const chapters = outline.chapters;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<Creating | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ type: 'container' | 'item'; id: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ type: 'container' | 'item'; id: string; title: string; count: number } | null>(null);
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  const [dropTarget, setDropTarget] = useState<{ containerId: string; index: number } | null>(null);
  const filtering = query.trim().length > 0;
  const titleOf = (id: string) => chapters.find(chapter => chapter.id === id)?.title || chapters.flatMap(chapter => chapter.lessons).find(lesson => lesson.id === id)?.title || '';

  /** Serialized API operation with optimistic state and rollback. */
  const run = async (operation: () => Promise<Outline>, options: { optimistic?: CourseChapter[]; success?: string } = {}) => {
    if (busy) { setAnnouncement(t('courseContentUi.busy')); return null; }
    const previous = outline;
    setBusy(true); setError('');
    if (options.optimistic) onOutline({ ...outline, chapters: options.optimistic });
    try {
      const result = await operation();
      onOutline({ structureVersion: result.structureVersion, chapters: result.chapters });
      if (options.success) setAnnouncement(options.success);
      return result;
    } catch (cause) {
      onOutline(previous);
      const code = errorCode(cause);
      if (code === 'STRUCTURE_CONFLICT') { setError(t('courseContentUi.conflict')); onReload(); }
      else setError(apiErrorMessage(t, cause));
      setAnnouncement(t('courseContentUi.failed'));
      return null;
    } finally { setBusy(false); }
  };

  const move = (request: MoveRequest) => {
    const title = titleOf(request.id);
    const destination = request.type === 'item' ? chapters.find(chapter => chapter.id === request.toContainerId)?.title : undefined;
    return run(() => courseContentApi.move(courseId, request, outline.structureVersion), {
      optimistic: applyMove(chapters, request),
      success: request.type === 'container' ? t('courseContentUi.movedContainer', { title, position: request.toIndex + 1 }) : t('courseContentUi.movedItem', { title, container: destination, position: request.toIndex + 1 }),
    });
  };

  // --- Drag and drop --------------------------------------------------------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: typedKeyboardCoordinates }),
  );
  /** Containers only collide with containers; items with items and container bodies (pointer first, then nearest). */
  const collisionDetection: CollisionDetection = args => {
    const type = (args.active.data.current as DragData | undefined)?.type;
    const droppableContainers = args.droppableContainers.filter(candidate => acceptsDrop(args.active.data.current as DragData | undefined, candidate.data.current as DragData | undefined));
    if (type === 'item') {
      const within = pointerWithin({ ...args, droppableContainers });
      const preferred = within.filter(collision => String(collision.id).startsWith('i:'));
      if (preferred.length) return preferred;
      if (within.length) return within;
    }
    return closestCenter({ ...args, droppableContainers });
  };
  const destinationOf = (active: DragData, overId: UniqueIdentifier | undefined, overData: DragData | undefined): MoveRequest | null => {
    if (!overId || !overData) return null;
    if (active.type === 'container') {
      if (overData.type !== 'container') return null;
      const toIndex = chapters.findIndex(chapter => chapter.id === overData.id);
      return toIndex < 0 ? null : { type: 'container', id: active.id, toIndex };
    }
    if (active.type !== 'item') return null;
    const containerId = overData.type === 'item' || overData.type === 'body' ? overData.containerId : overData.id;
    const container = chapters.find(chapter => chapter.id === containerId);
    if (!container) return null;
    if (overData.type === 'item') {
      const toIndex = container.lessons.findIndex(lesson => lesson.id === overData.id);
      return { type: 'item', id: active.id, toContainerId: containerId, toIndex };
    }
    const sameContainer = active.containerId === containerId;
    return { type: 'item', id: active.id, toContainerId: containerId, toIndex: sameContainer ? container.lessons.length - 1 : container.lessons.length };
  };
  const onDragStart = ({ active }: DragStartEvent) => { setActiveDrag(active.data.current as DragData); setError(''); };
  const onDragOver = ({ active, over }: DragOverEvent) => {
    const request = destinationOf(active.data.current as DragData, over?.id, over?.data.current as DragData | undefined);
    setDropTarget(request?.type === 'item' && request.toContainerId !== (active.data.current as { containerId?: string }).containerId ? { containerId: request.toContainerId, index: request.toIndex } : null);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveDrag(null); setDropTarget(null);
    const request = destinationOf(active.data.current as DragData, over?.id, over?.data.current as DragData | undefined);
    if (!request) return;
    const current = request.type === 'container' ? chapters.findIndex(chapter => chapter.id === request.id) : chapters.find(chapter => chapter.id === request.toContainerId)?.lessons.findIndex(lesson => lesson.id === request.id);
    const sameContainer = request.type === 'container' || chapters.find(chapter => chapter.id === request.toContainerId)?.lessons.some(lesson => lesson.id === request.id);
    if (sameContainer && current === request.toIndex) return;
    void move(request);
  };
  const dragLabel = (id: UniqueIdentifier) => titleOf(String(id).slice(2));
  const announcements: Announcements = useMemo(() => ({
    onDragStart: ({ active }) => t('courseContentUi.dnd.start', { title: dragLabel(active.id) }),
    onDragOver: ({ active, over }) => over ? t('courseContentUi.dnd.over', { title: dragLabel(active.id), target: String(over.id).startsWith('d:') ? titleOf(String(over.id).slice(2)) : dragLabel(over.id) }) : t('courseContentUi.dnd.outside'),
    onDragEnd: ({ active, over }) => over ? t('courseContentUi.dnd.end', { title: dragLabel(active.id) }) : t('courseContentUi.dnd.cancel'),
    onDragCancel: ({ active }) => t('courseContentUi.dnd.cancelOf', { title: dragLabel(active.id) }),
  }), [chapters, t]);

  // --- Other operations -----------------------------------------------------------------------------------------------
  const setVisibility = (type: 'container' | 'item', id: string, visibility: ContentVisibility) => {
    const optimistic = chapters.map(chapter => type === 'container' && chapter.id === id ? { ...chapter, visibility } : { ...chapter, lessons: chapter.lessons.map(lesson => lesson.id === id ? { ...lesson, visibility } : lesson) });
    const operation = type === 'container' ? () => courseContentApi.updateContainer(courseId, id, { visibility }) : () => courseContentApi.updateItem(courseId, id, { visibility });
    void run(operation, { optimistic, success: t(visibility === 'visible' ? 'courseContentUi.nowVisible' : 'courseContentUi.nowHidden', { title: titleOf(id) }) });
  };
  const batch = (visibility: ContentVisibility) => {
    const containerIds = chapters.filter(chapter => selected.has(chapter.id)).map(chapter => chapter.id);
    const itemIds = chapters.flatMap(chapter => chapter.lessons).filter(lesson => selected.has(lesson.id)).map(lesson => lesson.id);
    void run(() => courseContentApi.batch(courseId, { containerIds, itemIds, visibility }), { success: t('courseContentUi.batchDone', { count: containerIds.length + itemIds.length }) }).then(result => { if (result) setSelected(new Set()); });
  };
  const create = async (input: CreateInput) => {
    if (!creating) return;
    const result = creating.kind === 'container'
      ? await run(() => courseContentApi.createContainer(courseId, { expectedVersion: outline.structureVersion, kind: input.kind || 'module', title: input.title, index: creating.index }), { success: t('courseContentUi.created', { title: input.title }) })
      : await run(() => courseContentApi.createItem(courseId, { expectedVersion: outline.structureVersion, containerId: creating.containerId, type: input.type || 'text', title: input.title, url: input.url, ltiToolId: input.ltiToolId, scormPackageId: input.scormPackageId, index: creating.index }), { success: t('courseContentUi.created', { title: input.title }) });
    if (result) setCreating(null);
  };
  const toggleSelected = (id: string, checked: boolean) => setSelected(current => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; });

  const normalized = query.trim().toLowerCase();
  const matches = (text?: string) => !!text && text.toLowerCase().includes(normalized);
  const visibleChapters = filtering ? chapters.filter(chapter => matches(chapter.title) || matches(chapter.description) || chapter.lessons.some(lesson => matches(lesson.title) || matches(lesson.description))) : chapters;
  const dragDisabled = busy || filtering;
  const overlayTitle = activeDrag ? titleOf(activeDrag.type === 'body' ? activeDrag.containerId : activeDrag.id) : '';

  return (
    <div className="space-y-3">
      <p className="sr-only" aria-live="polite" role="status">{announcement}</p>
      <ErrorAlert message={error} onRetry={error ? () => { setError(''); onReload(); } : undefined} />
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
        <label className="relative flex-1 max-w-md">
          <span className="sr-only">{t('courseContentUi.search')}</span>
          <Search className="absolute start-2.5 top-2.5 w-4 h-4 text-slate-400" aria-hidden />
          <Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('courseContentUi.search')} className="ps-8" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {selected.size > 0 && <>
            <span className="text-xs text-slate-600">{t('courseContentUi.selected', { count: selected.size })}</span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => batch('visible')} leftIcon={<Eye className="w-3.5 h-3.5" />}>{t('courseContentUi.batchShow')}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => batch('hidden')} leftIcon={<EyeOff className="w-3.5 h-3.5" />}>{t('courseContentUi.batchHide')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t('courseContentUi.clearSelection')}</Button>
          </>}
          <Button size="sm" variant="ghost" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(chapters.map(chapter => chapter.id)))}>{collapsed.size ? t('courseContentUi.expandAll') : t('courseContentUi.collapseAll')}</Button>
        </div>
      </div>
      {filtering && <p className="text-xs text-slate-500" role="status">{t('courseContentUi.searchResults', { count: visibleChapters.length })} · {t('courseContentUi.searchNoDrag')}</p>}

      <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}
        onDragCancel={() => { setActiveDrag(null); setDropTarget(null); }}
        accessibility={{ announcements, screenReaderInstructions: { draggable: t('courseContentUi.dnd.instructions') } }}>
        <SortableContext items={visibleChapters.map(chapter => `c:${chapter.id}`)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-1" aria-label={t('courseContentUi.outline')}>
            {!filtering && <li><Inserter label={t('courseContentUi.addContainerAt', { position: 1 })} disabled={busy} onClick={() => setCreating({ kind: 'container', index: 0 })} /></li>}
            {creating?.kind === 'container' && creating.index === 0 && <li><CreateForm courseId={courseId} creating={creating} busy={busy} onCancel={() => setCreating(null)} onSubmit={input => void create(input)} /></li>}
            {visibleChapters.map(chapter => {
              const index = chapters.findIndex(candidate => candidate.id === chapter.id);
              const lessons = filtering && !(matches(chapter.title) || matches(chapter.description)) ? chapter.lessons.filter(lesson => matches(lesson.title) || matches(lesson.description)) : chapter.lessons;
              const expanded = filtering || !collapsed.has(chapter.id);
              return (
                <li key={chapter.id} className="space-y-1">
                  <ContainerCard chapter={chapter} index={index} count={chapters.length} dragDisabled={dragDisabled} expanded={expanded} busy={busy}
                    onToggle={() => setCollapsed(current => { const next = new Set(current); if (next.has(chapter.id)) next.delete(chapter.id); else next.add(chapter.id); return next; })}
                    selected={selected.has(chapter.id)} onSelect={checked => toggleSelected(chapter.id, checked)}
                    onVisibility={value => setVisibility('container', chapter.id, value)} onMove={toIndex => void move({ type: 'container', id: chapter.id, toIndex })}
                    onMoveDialog={() => setMoveTarget({ type: 'container', id: chapter.id })}
                    onDuplicate={() => void run(() => courseContentApi.duplicateContainer(courseId, chapter.id, outline.structureVersion, t('courseContentUi.copySuffix')), { success: t('courseContentUi.duplicated', { title: chapter.title }) })}
                    onDelete={() => setPendingDelete({ type: 'container', id: chapter.id, title: chapter.title, count: chapter.lessons.length })}
                    onEdit={() => setEditing(editing === chapter.id ? null : chapter.id)}>
                    {editing === chapter.id && <ContainerSettings courseId={courseId} chapter={chapter} busy={busy} onCancel={() => setEditing(null)}
                      onSave={patch => void run(() => courseContentApi.updateContainer(courseId, chapter.id, patch), { success: t('courseContentUi.saved') }).then(result => { if (result) setEditing(null); })} />}
                    <ContainerDropZone chapter={chapter} active={dropTarget?.containerId === chapter.id}>
                      <SortableContext items={lessons.map(lesson => `i:${lesson.id}`)} strategy={verticalListSortingStrategy}>
                        <ul className="space-y-0.5" aria-label={t('courseContentUi.itemsOf', { title: chapter.title })}>
                          {!filtering && <li><Inserter label={t('courseContentUi.addItemAt', { container: chapter.title, position: 1 })} disabled={busy} onClick={() => setCreating({ kind: 'item', containerId: chapter.id, index: 0 })} /></li>}
                          {creating?.kind === 'item' && creating.containerId === chapter.id && creating.index === 0 && <li><CreateForm courseId={courseId} creating={creating} busy={busy} onCancel={() => setCreating(null)} onSubmit={input => void create(input)} /></li>}
                          {lessons.map(lesson => {
                            const itemIndex = chapter.lessons.findIndex(candidate => candidate.id === lesson.id);
                            return (
                              <React.Fragment key={lesson.id}>
                                <ItemRow courseId={courseId} item={lesson} index={itemIndex} chapter={chapter} chapterIndex={index} chapters={chapters} busy={busy} dragDisabled={dragDisabled}
                                  dropBefore={dropTarget?.containerId === chapter.id && dropTarget.index === itemIndex}
                                  selected={selected.has(lesson.id)} onSelect={checked => toggleSelected(lesson.id, checked)}
                                  onVisibility={value => setVisibility('item', lesson.id, value)} onMove={request => void move(request)}
                                  onMoveDialog={() => setMoveTarget({ type: 'item', id: lesson.id })}
                                  onDuplicate={() => void run(() => courseContentApi.duplicateItem(courseId, lesson.id, outline.structureVersion, t('courseContentUi.copySuffix')), { success: t('courseContentUi.duplicated', { title: lesson.title }) })}
                                  onDelete={() => setPendingDelete({ type: 'item', id: lesson.id, title: lesson.title, count: 0 })} />
                                {!filtering && <li><Inserter label={t('courseContentUi.addItemAt', { container: chapter.title, position: itemIndex + 2 })} disabled={busy} onClick={() => setCreating({ kind: 'item', containerId: chapter.id, index: itemIndex + 1 })} /></li>}
                                {creating?.kind === 'item' && creating.containerId === chapter.id && creating.index === itemIndex + 1 && <li><CreateForm courseId={courseId} creating={creating} busy={busy} onCancel={() => setCreating(null)} onSubmit={input => void create(input)} /></li>}
                              </React.Fragment>
                            );
                          })}
                          {dropTarget?.containerId === chapter.id && dropTarget.index >= chapter.lessons.length && <li aria-hidden className="h-0.5 rounded bg-indigo-500" />}
                          {chapter.lessons.length === 0 && <li className="py-2 text-center text-xs text-slate-400">{t('courseContentUi.emptyContainer')}</li>}
                        </ul>
                      </SortableContext>
                    </ContainerDropZone>
                  </ContainerCard>
                  {!filtering && <Inserter label={t('courseContentUi.addContainerAt', { position: index + 2 })} disabled={busy} onClick={() => setCreating({ kind: 'container', index: index + 1 })} />}
                  {creating?.kind === 'container' && creating.index === index + 1 && <CreateForm courseId={courseId} creating={creating} busy={busy} onCancel={() => setCreating(null)} onSubmit={input => void create(input)} />}
                </li>
              );
            })}
          </ol>
        </SortableContext>
        <DragOverlay>{activeDrag ? <div className="rounded-lg border border-indigo-400 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-xl">{overlayTitle}</div> : null}</DragOverlay>
      </DndContext>
      {chapters.length === 0 && !creating && (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          <p className="mb-3">{t('courseContentUi.emptyCourse')}</p>
          <Button size="sm" onClick={() => setCreating({ kind: 'container', index: 0 })} leftIcon={<Plus className="w-4 h-4" />}>{t('courseContentUi.addContainer')}</Button>
        </div>
      )}

      {moveTarget && <MoveDialog chapters={chapters} target={moveTarget} onCancel={() => setMoveTarget(null)} onConfirm={request => { setMoveTarget(null); void move(request); }} />}
      <ConfirmationDialog isOpen={!!pendingDelete} isDangerous isLoading={busy}
        title={t('courseContentUi.deleteTitle', { title: pendingDelete?.title })}
        description={pendingDelete?.type === 'container' ? t('courseContentUi.deleteContainerDescription', { count: pendingDelete.count }) : t('courseContentUi.deleteItemDescription')}
        confirmLabel={t('courseContentUi.delete')} onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          const target = pendingDelete;
          void run(() => target.type === 'container' ? courseContentApi.deleteContainer(courseId, target.id, outline.structureVersion) : courseContentApi.deleteItem(courseId, target.id, outline.structureVersion), { success: t('courseContentUi.deleted', { title: target.title }) })
            .then(() => setPendingDelete(null));
        }} />
    </div>
  );
};
