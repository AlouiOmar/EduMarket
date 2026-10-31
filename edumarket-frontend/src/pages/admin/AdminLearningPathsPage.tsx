import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from '../../components/atoms/Button';
import { Badge } from '../../components/atoms/Badge';
import { Input } from '../../components/atoms/Input';
import { Select } from '../../components/atoms/Select';
import { Textarea } from '../../components/atoms/Textarea';
import { FormField } from '../../components/molecules/FormField';
import { ApiModeNotice, ErrorAlert, LoadingState, PageHeader } from '../../components/molecules/PageStates';
import { learningPathApi, moderationApi } from '../../services/platformServices';
import { usesApi } from '../../services/apiClient';
import { apiErrorMessage } from '../../utils/apiErrors';
import type { AdminLearningPath, ModerationCourse } from '../../types/platform';

type PathDraft = Omit<AdminLearningPath, 'id'>;
const emptyPath: PathDraft = { slug: '', title: { fr: '', en: '', ar: '' }, description: { fr: '', en: '', ar: '' }, skills: [], courseIds: [], active: true, order: 0 };
const LANGS = [['fr', 'Fr'], ['en', 'En'], ['ar', 'Ar']] as const;

/** Curated learning paths built from published courses (admin only). */
export const AdminLearningPathsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const language = i18n.language.slice(0, 2) as 'fr' | 'en' | 'ar';
  const [paths, setPaths] = useState<AdminLearningPath[] | null>(null);
  const [courses, setCourses] = useState<ModerationCourse[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PathDraft>(emptyPath);
  const [skillsText, setSkillsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    Promise.all([learningPathApi.adminList(), moderationApi.courses({ status: 'published' })])
      .then(([list, published]) => { setPaths(list); setCourses(published.data); })
      .catch(cause => setError(apiErrorMessage(t, cause)));
  }, [t]);
  useEffect(() => { if (usesApi) load(); }, [load]);

  if (!usesApi) return <div className="space-y-6"><PageHeader title={t('marketingUi.adminTitle')} subtitle={t('marketingUi.adminSubtitle')} /><ApiModeNotice /></div>;

  const edit = (path?: AdminLearningPath) => {
    const value: PathDraft = path ? { slug: path.slug, title: path.title, description: path.description, skills: path.skills, courseIds: path.courseIds, active: path.active, order: path.order } : emptyPath;
    setDraft(value); setSkillsText(value.skills.join(', ')); setEditingId(path?.id || 'new'); setError('');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    const input = { ...draft, skills: skillsText.split(',').map(skill => skill.trim()).filter(Boolean) };
    try {
      if (editingId === 'new') await learningPathApi.create(input);
      else if (editingId) await learningPathApi.update(editingId, input);
      setEditingId(null); load();
    } catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    try { await learningPathApi.remove(id); load(); } catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  const courseTitle = (id: string) => courses.find(course => course.id === id)?.title || id;
  const setLocalized = (field: 'title' | 'description', lang: 'fr' | 'en' | 'ar', value: string) =>
    setDraft(prev => ({ ...prev, [field]: { ...prev[field], [lang]: value } }));

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader title={t('marketingUi.adminTitle')} subtitle={t('marketingUi.adminSubtitle')}
        actions={<Button variant="primary" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => edit()}>{t('marketingUi.newPath')}</Button>} />
      <ErrorAlert message={error} />
      {editingId && (
        <form onSubmit={save} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-900">{editingId === 'new' ? t('marketingUi.newPath') : t('marketingUi.editPath')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={t('adminPanel.slug')} required><Input value={draft.slug} onChange={event => setDraft(prev => ({ ...prev, slug: event.target.value.toLowerCase() }))} pattern="[a-z0-9]+(-[a-z0-9]+)*" required /></FormField>
            <FormField label={t('marketingUi.skillsInput')}><Input value={skillsText} onChange={event => setSkillsText(event.target.value)} /></FormField>
            {LANGS.map(([lang, suffix]) => (
              <FormField key={`title-${lang}`} label={t(`marketingUi.title${suffix}`)} required>
                <Input dir={lang === 'ar' ? 'rtl' : undefined} value={draft.title[lang]} onChange={event => setLocalized('title', lang, event.target.value)} minLength={2} required />
              </FormField>
            ))}
            {LANGS.map(([lang, suffix]) => (
              <FormField key={`description-${lang}`} label={t(`marketingUi.description${suffix}`)} required className="sm:col-span-2">
                <Textarea dir={lang === 'ar' ? 'rtl' : undefined} rows={2} value={draft.description[lang]} onChange={event => setLocalized('description', lang, event.target.value)} minLength={2} required />
              </FormField>
            ))}
          </div>
          <div className="space-y-2">
            <span className="text-xs font-semibold text-slate-700">{t('marketingUi.coursesInput')}</span>
            <ol className="space-y-1 text-xs">
              {draft.courseIds.map((courseId, index) => (
                <li key={courseId} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-3 py-2">
                  <span>{index + 1}. {courseTitle(courseId)}</span>
                  <button type="button" aria-label={t('marketingUi.deletePath')} className="text-rose-600 px-1" onClick={() => setDraft(prev => ({ ...prev, courseIds: prev.courseIds.filter(id => id !== courseId) }))}>×</button>
                </li>
              ))}
            </ol>
            <Select aria-label={t('marketingUi.addCourse')} value="" onChange={event => { const value = event.target.value; if (value) setDraft(prev => ({ ...prev, courseIds: [...prev.courseIds, value] })); }}
              options={[{ value: '', label: t('marketingUi.addCourse') }, ...courses.filter(course => !draft.courseIds.includes(course.id)).map(course => ({ value: course.id, label: course.title }))]} />
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={draft.active} onChange={event => setDraft(prev => ({ ...prev, active: event.target.checked }))} /> {t('marketingUi.active')}
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>{t('platformCommon.cancel')}</Button>
            <Button type="submit" variant="primary" size="sm" isLoading={busy}>{t('marketingUi.savePath')}</Button>
          </div>
        </form>
      )}
      {!paths && !error && <LoadingState />}
      {paths?.length === 0 && !editingId && <p className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">{t('marketingUi.noPaths')}</p>}
      {!!paths?.length && (
        <ul className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 shadow-xs">
          {paths.map(path => (
            <li key={path.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
              <div>
                <span className="font-semibold text-slate-900">{path.title[language] || path.title.fr}</span>
                <span className="block text-xs text-slate-500 font-mono">{path.slug} · {t('adminPanel.coursesCount', { count: path.courseIds.length })}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={path.active ? 'success' : 'default'} size="sm">{path.active ? t('marketingUi.active') : t('marketingUi.inactive')}</Badge>
                <Button variant="outline" size="sm" onClick={() => edit(path)}>{t('common.edit')}</Button>
                <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => void remove(path.id)}>{t('marketingUi.deletePath')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
