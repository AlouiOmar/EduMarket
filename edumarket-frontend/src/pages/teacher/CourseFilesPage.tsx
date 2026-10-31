import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Archive, FileUp, Link2, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { Badge } from '../../components/atoms/Badge';
import { Button } from '../../components/atoms/Button';
import { ConfirmationDialog } from '../../components/molecules/ConfirmationDialog';
import { ErrorAlert, LoadingState, NoticeBanner } from '../../components/molecules/PageStates';
import { TeacherCourseFrame } from '../../components/organisms/LmsShared';
import { formatBytes } from '../../components/organisms/LessonBlocksView';
import { courseContentApi, type CopyReport, type CourseFile, type LinkReport } from '../../services/courseContentService';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';

const STATUS_VARIANT = { used: 'success', unused: 'warning', quarantined: 'danger' } as const;
const LINK_VARIANT = { ok: 'success', redirect: 'info', broken: 'danger', error: 'warning', blocked: 'default' } as const;

/**
 * Course files and links: where each file is used, quarantine of unused files with deferred deletion (never a file still
 * referenced), external link report, and the complete archive (files + SHA-256 manifest, EduMarket format).
 */
export const CourseFilesPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const [files, setFiles] = useState<CourseFile[] | null>(null);
  const [report, setReport] = useState<LinkReport | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<CourseFile | null>(null);
  const [importReport, setImportReport] = useState<CopyReport | null>(null);
  const load = useCallback(() => {
    courseContentApi.files(id).then(setFiles).catch(cause => setError(apiErrorMessage(t, cause)));
    courseContentApi.linkReport(id).then(setReport).catch(() => setReport(null));
  }, [id, t]);
  useEffect(() => { load(); }, [load]);
  const act = async (operation: () => Promise<unknown>, success: string) => { setError(''); setMessage(''); try { await operation(); setMessage(success); load(); } catch (cause) { setError(apiErrorMessage(t, cause)); } };
  const runCheck = async () => { setChecking(true); setError(''); try { setReport(await courseContentApi.runLinkCheck(id)); } catch (cause) { setError(apiErrorMessage(t, cause)); } finally { setChecking(false); } };
  const importArchive = async (file: File) => {
    setBusy('import'); setError(''); setImportReport(null);
    try { const { outline } = await courseContentApi.outline(id); setImportReport((await courseContentApi.importArchive(id, outline.structureVersion, file)).report); load(); }
    catch (cause) { setError(apiErrorMessage(t, cause)); } finally { setBusy(''); }
  };
  return (
    <TeacherCourseFrame courseId={id} title={t('filesUi.title')} subtitle={t('filesUi.subtitle')} actions={<>
      <Button size="sm" variant="outline" leftIcon={<Archive className="w-3.5 h-3.5" />} isLoading={busy === 'export'} onClick={() => { setBusy('export'); courseContentApi.exportArchive(id, `course-${id}.zip`).catch(cause => setError(apiErrorMessage(t, cause))).finally(() => setBusy('')); }}>{t('filesUi.exportArchive')}</Button>
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-indigo-500">
        <FileUp className="w-3.5 h-3.5" aria-hidden />{busy === 'import' ? t('courseContentUi.importing') : t('filesUi.importArchive')}
        <input type="file" accept=".zip,application/zip" className="sr-only" disabled={!!busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importArchive(file); }} />
      </label>
    </>}>
      <ErrorAlert message={error} />
      {message && <NoticeBanner tone="success">{message}</NoticeBanner>}
      {importReport && <NoticeBanner tone="success">{t('filesUi.imported', { containers: importReport.copiedContainers, items: importReport.copiedItems, files: importReport.copiedAssets })}{importReport.skipped.length ? ` ${t('filesUi.importSkipped', { count: importReport.skipped.length })}` : ''}</NoticeBanner>}
      <p className="text-xs text-slate-600">{t('filesUi.archiveNote')}</p>

      <section className="space-y-2" aria-labelledby="files-title">
        <h2 id="files-title" className="text-sm font-semibold text-slate-900">{t('filesUi.inventory')}</h2>
        <p className="text-xs text-slate-600">{t('filesUi.rules')}</p>
        {!files ? <LoadingState /> : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-xs">
              <caption className="sr-only">{t('filesUi.caption')}</caption>
              <thead className="bg-slate-50 text-slate-600"><tr>
                <th scope="col" className="px-3 py-2 text-start">{t('filesUi.name')}</th><th scope="col" className="text-start">{t('filesUi.type')}</th><th scope="col">{t('filesUi.size')}</th>
                <th scope="col" className="text-start">{t('filesUi.usedBy')}</th><th scope="col">{t('filesUi.status')}</th><th scope="col"><span className="sr-only">{t('filesUi.actions')}</span></th>
              </tr></thead>
              <tbody>
                {files.map(file => (
                  <tr key={file.id} className="border-t border-slate-100">
                    <th scope="row" className="px-3 py-1.5 text-start font-medium text-slate-800">{file.name}<span className="block text-[10px] font-normal text-slate-500">{formatDateTime(file.createdAt, i18n.language)}{file.storage !== 'local' ? ` · ${file.storage}` : ''}</span></th>
                    <td>{file.mimeType}</td><td className="text-center">{formatBytes(file.size)}</td>
                    <td>{file.references.length ? <ul>{file.references.map((reference, index) => <li key={index}>{t(`filesUi.referenceKinds.${reference.kind}`)}{reference.label ? ` · ${reference.label}` : ''}</li>)}</ul> : <span className="text-slate-500">—</span>}</td>
                    <td className="text-center"><Badge size="sm" variant={STATUS_VARIANT[file.status]}>{t(`filesUi.statuses.${file.status}`)}</Badge>{file.purgeAfter && <span className="block text-[10px] text-slate-500">{t('filesUi.purgeOn', { date: formatDateTime(file.purgeAfter, i18n.language) })}</span>}</td>
                    <td className="whitespace-nowrap px-2 text-end">
                      {file.status === 'unused' && <Button size="sm" variant="outline" leftIcon={<ShieldAlert className="w-3.5 h-3.5" />} onClick={() => void act(() => courseContentApi.quarantineFile(id, file.id), t('filesUi.quarantined', { name: file.name }))}>{t('filesUi.quarantine')}</Button>}
                      {file.status === 'quarantined' && <>
                        <Button size="sm" variant="ghost" leftIcon={<RotateCcw className="w-3.5 h-3.5" />} onClick={() => void act(() => courseContentApi.restoreFile(id, file.id), t('filesUi.restored', { name: file.name }))}>{t('filesUi.restore')}</Button>
                        <Button size="sm" variant="ghost" leftIcon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => setConfirm(file)}>{t('filesUi.deleteNow')}</Button>
                      </>}
                    </td>
                  </tr>
                ))}
                {!files.length && <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">{t('filesUi.noFiles')}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="links-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="links-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Link2 className="w-4 h-4" aria-hidden />{t('filesUi.linkCheck')}</h2>
          <Button size="sm" variant="outline" isLoading={checking} onClick={() => void runCheck()}>{t('filesUi.runCheck')}</Button>
        </div>
        <p className="text-xs text-slate-600">{t('filesUi.linkRules')}</p>
        {report === undefined ? <LoadingState /> : report === null ? <p className="text-sm text-slate-500">{t('filesUi.noReport')}</p> : (
          <>
            <p role="status" className="text-xs text-slate-700">{t('filesUi.reportSummary', { date: formatDateTime(report.checkedAt, i18n.language), total: report.results.length, broken: report.broken })}{report.truncated ? ` ${t('filesUi.truncated')}` : ''}</p>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-xs">
              {[...report.results].sort((a, b) => Number(b.status === 'broken') - Number(a.status === 'broken')).map(result => (
                <li key={result.url} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 break-all"><a className="text-indigo-700 underline" href={result.url} target="_blank" rel="noopener noreferrer nofollow">{result.url}</a>
                    {result.finalUrl && <span className="block text-slate-500">→ {result.finalUrl}</span>}
                    <span className="block text-slate-500">{result.locations.map(location => <Link key={location.itemId} className="me-2 underline" to={`/teacher/courses/${id}/content/items/${location.itemId}`}>{location.containerTitle} › {location.title}</Link>)}</span></span>
                  <Badge size="sm" variant={LINK_VARIANT[result.status]}>{t(`filesUi.linkStatus.${result.status}`)}{result.httpStatus ? ` ${result.httpStatus}` : ''}{result.error ? ` · ${result.error}` : ''}</Badge>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <ConfirmationDialog isOpen={!!confirm} title={t('filesUi.deleteTitle')} description={t('filesUi.deleteDescription', { name: confirm?.name })} confirmLabel={t('filesUi.deleteNow')} isDangerous
        onCancel={() => setConfirm(null)} onConfirm={() => { const file = confirm!; setConfirm(null); void act(() => courseContentApi.deleteFile(id, file.id), t('filesUi.deleted', { name: file.name })); }} />
    </TeacherCourseFrame>
  );
};
