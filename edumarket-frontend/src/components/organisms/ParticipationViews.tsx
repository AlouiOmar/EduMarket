import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, EyeOff, Eye, Pin, Trash2, Upload } from 'lucide-react';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';
import { Textarea } from '../atoms/Textarea';
import { FormField } from '../molecules/FormField';
import { ErrorAlert, LoadingState } from '../molecules/PageStates';
import { RichTextView } from './LessonBlocksView';
import { participationApi, type Discussion, type DiscussionPost, type GroupFile, type JournalEntry } from '../../services/participationService';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';
import { formatBytes } from './LessonBlocksView';

/** Discussion thread: posts and replies; managers moderate (hide with a note, pin) and see hidden posts. */
export const DiscussionThread: React.FC<{ courseId: string; discussionId: string; manager: boolean; currentUserId?: string; onChanged?: () => void }> = ({ courseId, discussionId, manager, currentUserId, onChanged }) => {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<{ discussion: Discussion; posts: DiscussionPost[] } | null>(null);
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<DiscussionPost | null>(null);
  const load = useCallback(() => participationApi.posts(courseId, discussionId).then(setData).catch(cause => setError(apiErrorMessage(t, cause))), [courseId, discussionId, t]);
  useEffect(() => { void load(); }, [load]);
  const act = async (operation: () => Promise<unknown>) => { setError(''); try { await operation(); await load(); onChanged?.(); } catch (cause) { setError(apiErrorMessage(t, cause)); } };
  if (!data) return error ? <ErrorAlert message={error} /> : <LoadingState />;
  const { discussion, posts } = data;
  const roots = posts.filter(post => !post.parentId);
  const repliesOf = (id: string) => posts.filter(post => post.parentId === id);
  const renderPost = (post: DiscussionPost, depth = 0) => (
    <li key={post.id} className={`${depth ? 'ms-6 border-s-2 border-slate-100 ps-3' : ''}`}>
      <article className={`space-y-1 rounded-lg border p-3 ${post.status === 'hidden' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`} aria-label={t('participationUi.postBy', { name: post.authorName })}>
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-800">{post.authorName}</span>
          {post.authorRole !== 'student' && <Badge size="sm" variant="info">{t('participationUi.teacherBadge')}</Badge>}
          <span>{formatDateTime(post.createdAt, i18n.language)}</span>
          {post.editedAt && <span>· {t('participationUi.edited')}</span>}
          {post.pinned && <Badge size="sm" variant="purple">{t('participationUi.pinned')}</Badge>}
          {post.status === 'hidden' && <Badge size="sm" variant="warning">{t('participationUi.hiddenPost', { note: post.moderationNote || '—' })}</Badge>}
        </p>
        <RichTextView html={post.body} className="text-sm" />
        <div className="flex flex-wrap gap-1">
          {discussion.status === 'open' && post.status !== 'hidden' && <Button size="sm" variant="ghost" onClick={() => setReplyTo(post)}>{t('participationUi.reply')}</Button>}
          {manager && (
            <>
              <Button size="sm" variant="ghost" leftIcon={post.status === 'hidden' ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                onClick={() => { const note = post.status === 'hidden' ? '' : window.prompt(t('participationUi.moderationNotePrompt')) ?? null; if (note !== null) void act(() => participationApi.updatePost(courseId, discussion.id, post.id, { status: post.status === 'hidden' ? 'visible' : 'hidden', moderationNote: note })); }}>
                {post.status === 'hidden' ? t('participationUi.show') : t('participationUi.hide')}
              </Button>
              <Button size="sm" variant="ghost" leftIcon={<Pin className="w-3.5 h-3.5" />} onClick={() => void act(() => participationApi.updatePost(courseId, discussion.id, post.id, { pinned: !post.pinned }))}>{post.pinned ? t('participationUi.unpin') : t('participationUi.pin')}</Button>
            </>
          )}
          {currentUserId === post.authorId && post.status !== 'hidden' && discussion.status === 'open' && (
            <Button size="sm" variant="ghost" onClick={() => { const next = window.prompt(t('participationUi.editPrompt'), post.body.replace(/<[^>]*>/g, '')); if (next?.trim()) void act(() => participationApi.updatePost(courseId, discussion.id, post.id, { body: next })); }}>{t('lmsCommon.edit')}</Button>
          )}
        </div>
      </article>
      {repliesOf(post.id).length > 0 && <ul className="mt-2 space-y-2">{repliesOf(post.id).map(reply => renderPost(reply, depth + 1))}</ul>}
    </li>
  );
  return (
    <section className="space-y-3" aria-labelledby={`discussion-${discussion.id}`}>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 id={`discussion-${discussion.id}`} className="text-base font-semibold text-slate-900">{discussion.title} {discussion.status === 'closed' && <Badge size="sm">{t('participationUi.closed')}</Badge>}</h2>
        {discussion.prompt && <RichTextView html={discussion.prompt} className="mt-2 text-sm" />}
        {discussion.graded && <p className="mt-1 text-xs text-slate-600">{t('participationUi.gradedOn', { points: discussion.points })}</p>}
      </div>
      <ErrorAlert message={error} />
      <ul className="space-y-2" aria-label={t('participationUi.posts')}>{roots.map(post => renderPost(post))}</ul>
      {!posts.length && <p className="text-sm text-slate-500">{t('participationUi.noPosts')}</p>}
      {discussion.status === 'open' && (
        <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (body.trim()) void act(async () => { await participationApi.createPost(courseId, discussion.id, body, replyTo?.id ?? null); setBody(''); setReplyTo(null); }); }}>
          {replyTo && <p className="text-xs text-slate-600">{t('participationUi.replyingTo', { name: replyTo.authorName })} <button type="button" className="underline" onClick={() => setReplyTo(null)}>{t('lmsCommon.cancel')}</button></p>}
          <FormField label={replyTo ? t('participationUi.yourReply') : t('participationUi.yourPost')}><Textarea rows={3} maxLength={20000} value={body} onChange={event => setBody(event.target.value)} /></FormField>
          <div className="flex justify-end"><Button size="sm" type="submit" disabled={!body.trim()}>{t('participationUi.publish')}</Button></div>
        </form>
      )}
    </section>
  );
};

/** Journal entries with comments. Students only receive their own entries from the API. */
export const JournalEntries: React.FC<{ courseId: string; entries: JournalEntry[]; onChanged: () => void; canComment: boolean }> = ({ courseId, entries, onChanged, canComment }) => {
  const { t, i18n } = useTranslation();
  const [comments, setComments] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const comment = async (entry: JournalEntry) => { setError(''); try { await participationApi.commentEntry(courseId, entry.id, comments[entry.id] || ''); setComments({ ...comments, [entry.id]: '' }); onChanged(); } catch (cause) { setError(apiErrorMessage(t, cause)); } };
  return (
    <div className="space-y-3">
      <ErrorAlert message={error} />
      <ol className="space-y-3">
        {entries.map(entry => (
          <li key={entry.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500"><span className="font-semibold text-slate-800">{entry.authorName}</span> · {formatDateTime(entry.createdAt, i18n.language)}</p>
            <RichTextView html={entry.body} className="text-sm" />
            {entry.comments.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-slate-50 p-2 text-xs">{entry.comments.map((item, index) => <li key={index}><span className="font-semibold">{item.authorName}</span> · {formatDateTime(item.createdAt, i18n.language)} : {item.body}</li>)}</ul>
            )}
            {canComment && (
              <div className="flex items-end gap-2">
                <FormField label={t('participationUi.comment')} className="flex-1"><Textarea rows={1} value={comments[entry.id] || ''} onChange={event => setComments({ ...comments, [entry.id]: event.target.value })} /></FormField>
                <Button size="sm" variant="outline" disabled={!(comments[entry.id] || '').trim()} onClick={() => void comment(entry)}>{t('participationUi.sendComment')}</Button>
              </div>
            )}
          </li>
        ))}
        {!entries.length && <li className="text-sm text-slate-500">{t('participationUi.noEntries')}</li>}
      </ol>
    </div>
  );
};

/** Files of a group space: members upload, download, and delete their own files (managers can delete any). */
export const GroupFiles: React.FC<{ courseId: string; groupId: string; manager: boolean; currentUserId?: string }> = ({ courseId, groupId, manager, currentUserId }) => {
  const { t, i18n } = useTranslation();
  const [files, setFiles] = useState<GroupFile[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => participationApi.groupFiles(courseId, groupId).then(setFiles).catch(cause => setError(apiErrorMessage(t, cause))), [courseId, groupId, t]);
  useEffect(() => { void load(); }, [load]);
  const upload = async (file: File) => { setBusy(true); setError(''); try { await participationApi.uploadGroupFile(courseId, groupId, file); await load(); } catch (cause) { setError(apiErrorMessage(t, cause)); } finally { setBusy(false); } };
  const remove = async (file: GroupFile) => { setError(''); try { await participationApi.deleteGroupFile(courseId, groupId, file.id); await load(); } catch (cause) { setError(apiErrorMessage(t, cause)); } };
  return (
    <div className="space-y-2">
      <ErrorAlert message={error} />
      {!files ? <LoadingState /> : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-xs">
          {files.map(file => (
            <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span><span className="font-semibold text-slate-800">{file.name}</span> · {formatBytes(file.size)} · {file.type} · {file.uploadedBy} · {formatDateTime(file.createdAt, i18n.language)}</span>
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" aria-label={t('participationUi.downloadFile', { name: file.name })} onClick={() => void participationApi.downloadGroupFile(file.url, file.name).catch(cause => setError(apiErrorMessage(t, cause)))}><Download className="w-3.5 h-3.5" /></Button>
                {(manager || file.uploaderId === currentUserId) && <Button size="sm" variant="ghost" aria-label={t('participationUi.deleteFile', { name: file.name })} onClick={() => void remove(file)}><Trash2 className="w-3.5 h-3.5" /></Button>}
              </span>
            </li>
          ))}
          {!files.length && <li className="px-3 py-2 text-slate-500">{t('participationUi.noFiles')}</li>}
        </ul>
      )}
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-indigo-500">
        <Upload className="w-3.5 h-3.5" aria-hidden />{busy ? t('participationUi.uploading') : t('participationUi.shareFile')}
        <input type="file" className="sr-only" accept=".pdf,.zip,.docx,.png,.jpg,.jpeg" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
      </label>
      <p className="text-[11px] text-slate-500">{t('participationUi.fileTypes')}</p>
    </div>
  );
};
