import React, { useEffect, useState } from 'react';
import { courseTeamApi, storageApi } from '../../services/platformServices';
import { useAuth } from '../../contexts/AuthContext';
import type { CoOwner, StorageAccount } from '../../types/platform';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Save, Plus, Trash2, CheckCircle2, ArrowLeft, LayoutList } from 'lucide-react';
import { courseService } from '../../services/courseService';
import { CourseChapter, CourseLesson, CourseSettings, CourseSyllabusEntry } from '../../types';
import { courseContentApi } from '../../services/courseContentService';
import { fromLocalInput, toLocalInput } from '../../utils/outline';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { Textarea } from '../../components/atoms/Textarea';
import { Select } from '../../components/atoms/Select';
import { FormField } from '../../components/molecules/FormField';
import { Switch } from '../../components/atoms/Switch';
import { LessonEditor, lessonIssues } from '../../components/organisms/LessonEditor';
import { apiAssetUrl, usesApi } from '../../services/apiClient';
import { courseWorkflowApi } from '../../services/platformServices';
import { apiErrorMessage } from '../../utils/apiErrors';
import type { PublicCategory } from '../../types/platform';

type Pathway = 'learning_and_quiz' | 'online_exam' | 'in_person_exam' | 'both';
const demoCategories = ['Développement Web & Cloud', 'Intelligence Artificielle & Data', 'Cybersécurité & Réseaux', 'Management & Entrepreneuriat'];

export const CourseEditorPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { role } = useAuth();
  const [apiCategories, setApiCategories] = useState<PublicCategory[]>([]);
  useEffect(() => { if (usesApi) courseWorkflowApi.categories().then(setApiCategories).catch(() => setApiCategories([])); }, []);
  const language = i18n.language.slice(0, 2) as 'fr' | 'en' | 'ar';
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'info' | 'curriculum' | 'pricing' | 'certification'>('info');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [assetBusy, setAssetBusy] = useState('');
  const [assetError, setAssetError] = useState('');

  // Mock mode keeps a pre-filled demo course; API mode starts empty.
  const [title, setTitle] = useState(usesApi ? '' : 'Nouvelle Formation Professionnelle');
  const [subtitle, setSubtitle] = useState(usesApi ? '' : 'Maîtrisez les concepts avancés de bout en bout');
  const [description, setDescription] = useState(usesApi ? '' : 'Ce cours complet aborde tous les aspects théoriques et pratiques...');
  const [category, setCategory] = useState(usesApi ? '' : demoCategories[0]);
  const [level, setLevel] = useState<'beginner' | 'intermediate' | 'advanced'>(usesApi ? 'beginner' : 'intermediate');
  const [isFree, setIsFree] = useState(usesApi);
  const [price, setPrice] = useState(usesApi ? 0 : 79);
  const [hasCertification, setHasCertification] = useState(!usesApi);
  const [certPathway, setCertPathway] = useState<Pathway>('learning_and_quiz');
  const [tagsText, setTagsText] = useState('');
  const [canManageCommercial, setCanManageCommercial] = useState(true);
  const [visibility, setVisibility] = useState<'public' | 'restricted'>('public');
  const [storageAccounts, setStorageAccounts] = useState<StorageAccount[]>([]);
  const [storageTarget, setStorageTarget] = useState('default');
  const [coOwners, setCoOwners] = useState<CoOwner[]>([]);
  const [courseCode, setCourseCode] = useState('');
  const [accessState, setAccessState] = useState<'open' | 'private' | 'completed'>('open');
  const [settings, setSettings] = useState<CourseSettings>({ language: 'fr', startsAt: null, endsAt: null, notifyStudents: true });
  const [syllabus, setSyllabus] = useState<CourseSyllabusEntry[]>([]);
  const [banner, setBanner] = useState({ assetId: '', alt: '', url: '' });
  const [bannerBusy, setBannerBusy] = useState(false);
  // Existing courses are structured in "Contenu du cours"; the legacy curriculum builder only seeds new courses.
  const liveOutline = usesApi && !!id;
  const [chapters, setChapters] = useState<CourseChapter[]>(usesApi ? [] : [{
    id: 'chap_new_1', title: 'Chapitre 1 : Introduction et Fondamentaux', order: 1,
    lessons: [{ id: 'les_new_1', chapterId: 'chap_new_1', title: 'Introduction au cours et objectifs pédagogiques', durationMinutes: 15, type: 'video', videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', resources: [], commentsCount: 0 }],
  }]);

  // Paired drives (teachers and institutions): uploads go to the chosen account, the default one, or local storage.
  useEffect(() => { if (usesApi && (role === 'teacher' || role === 'institution')) storageApi.accounts().then(setStorageAccounts).catch(() => setStorageAccounts([])); }, [role]);
  useEffect(() => {
    if (!id) return;
    let active = true;
    courseService.getCourseForEdit(id).then(result => {
      if (!active) return;
      const course = result.data;
      setTitle(course.title); setSubtitle(course.subtitle); setDescription(course.description);
      setCategory(course.category); setLevel(course.level === 'all' ? 'beginner' : course.level);
      setPrice(course.price); setIsFree(course.price === 0); setChapters(course.chapters || []);
      setHasCertification(course.hasCertification);
      setCertPathway(course.certificationPathway);
      setTagsText((course.tags || []).join(', '));
      setCanManageCommercial(course.canManageCommercial !== false);
      setVisibility(course.visibility === 'restricted' ? 'restricted' : 'public');
      setCoOwners(course.coOwners || []);
      setCourseCode(course.courseCode || '');
      setAccessState(course.accessState || 'open');
      if (course.settings) setSettings({ language: course.settings.language || 'fr', startsAt: course.settings.startsAt || null, endsAt: course.settings.endsAt || null, notifyStudents: course.settings.notifyStudents !== false, timezone: course.settings.timezone || null });
      setSyllabus(course.syllabus || []);
      setBanner({ assetId: course.banner?.assetId || '', alt: course.banner?.alt || '', url: course.bannerUrl || '' });
    }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [id]);

  const handleAddChapter = () => {
    setChapters(prev => [...prev, { id: `chap_${Date.now()}`, title: t('courseEditorUi.newChapter', { number: prev.length + 1 }), order: prev.length + 1, lessons: [] }]);
  };

  const handleAddLesson = (chapterId: string) => {
    setChapters(prev => prev.map(chapter => chapter.id !== chapterId ? chapter : {
      ...chapter,
      lessons: [...chapter.lessons, { id: `les_${Date.now()}`, chapterId, title: t('courseEditorUi.newLesson', { number: chapter.lessons.length + 1 }), durationMinutes: 20, type: 'video', resources: [], commentsCount: 0 }],
    }));
  };

  const updateLesson = (chapterId: string, lesson: CourseLesson) =>
    setChapters(prev => prev.map(chapter => chapter.id !== chapterId ? chapter : { ...chapter, lessons: chapter.lessons.map(item => item.id === lesson.id ? lesson : item) }));
  const deleteLesson = (chapterId: string, lessonId: string) =>
    setChapters(prev => prev.map(chapter => chapter.id !== chapterId ? chapter : { ...chapter, lessons: chapter.lessons.filter(item => item.id !== lessonId) }));

  const issues = liveOutline ? [] : [...new Set(chapters.flatMap(chapter => chapter.lessons.flatMap(lessonIssues)))];
  const syllabusInvalid = syllabus.some(entry => !entry.title.trim() || !entry.startsAt);
  const datesInvalid = !!settings.startsAt && !!settings.endsAt && new Date(settings.startsAt) >= new Date(settings.endsAt);
  const bannerInvalid = !!banner.assetId && !banner.alt.trim();

  const handleSave = async () => {
    if (issues.length) { setSaveError(issues.map(key => t(key)).join(' ')); setActiveTab('curriculum'); return; }
    if (syllabusInvalid || datesInvalid || bannerInvalid) { setSaveError(t('courseSettingsUi.fixSettings')); setActiveTab('info'); return; }
    setSaving(true); setSaveError('');
    try {
      const editableChapters = chapters.map((chapter, index) => ({
        ...chapter,
        order: index,
        lessons: chapter.lessons.map(lesson => ({
          ...lesson,
          ...(lesson.videoUrl?.startsWith('/courses/') ? { videoUrl: undefined } : {}),
          resources: lesson.resources.filter(resource => !resource.url.startsWith('/courses/')),
        })),
      }));
      const tags = tagsText.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 15);
      const commercial = canManageCommercial ? { isFree, price: isFree ? 0 : price, visibility, ...(usesApi && id ? { accessState } : {}) } : {};
      const teaching = usesApi ? { courseCode: courseCode.trim(), settings, syllabus, ...(id ? { banner: { assetId: banner.assetId, alt: banner.alt.trim() } } : {}) } : {};
      const course = { title, subtitle, description, category, level, ...commercial, ...teaching, tags, hasCertification, certificationPathway: certPathway, ...(liveOutline ? {} : { chapters: editableChapters }) };
      if (id) await courseService.updateCourse(id, course);
      else await courseService.createCourse(course);
      setSavedSuccess(true);
      setTimeout(() => navigate('/teacher/courses'), 1200);
    } catch (cause) { setSaveError(usesApi ? apiErrorMessage(t, cause) : t('courseEditorUi.saveError')); }
    finally { setSaving(false); }
  };

  const handleAssetUpload = async (chapterId: string, lessonId: string, kind: 'video' | 'resources', file: File) => {
    if (!id) { setAssetError(t('teacher.courseSaveBeforeUpload')); return; }
    const busyKey = `${lessonId}:${kind}`;
    setAssetBusy(busyKey); setAssetError('');
    try {
      const asset = await courseService.uploadLessonAsset(id, lessonId, kind, file, storageTarget);
      setChapters(current => current.map(chapter => chapter.id !== chapterId ? chapter : {
        ...chapter,
        lessons: chapter.lessons.map(lesson => lesson.id !== lessonId ? lesson : kind === 'video'
          ? { ...lesson, videoUrl: asset.url }
          : { ...lesson, resources: [...lesson.resources, { id: asset.id, title: asset.name, type: asset.type.includes('zip') ? 'zip' : 'pdf', size: `${(asset.size / (1024 * 1024)).toFixed(1)} MB`, url: asset.url }] }),
      }));
    } catch { setAssetError(t('teacher.courseAssetUploadError')); }
    finally { setAssetBusy(''); }
  };

  const tabClass = (tab: typeof activeTab) => `pb-3 border-b-2 transition-colors ${activeTab === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`;
  const categoryOptions = usesApi && apiCategories.length ? [
    { value: '', label: '—' },
    ...apiCategories.map(item => ({ value: item.id, label: item.names?.[language] || item.name })),
    ...(category && !apiCategories.some(item => item.id === category) ? [{ value: category, label: category }] : []),
  ] : demoCategories.map(value => ({ value, label: value }));

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/teacher/courses" className="text-slate-500 hover:text-slate-800" aria-label={t('courseEditorUi.back')}>
            <ArrowLeft className="w-5 h-5 rtl-flip" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{id ? t('courseEditorUi.editTitle') : t('courseEditorUi.createTitle')}</h1>
            <p className="text-xs text-slate-500">{t('courseEditorUi.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate('/teacher/courses')}>{t('platformCommon.cancel')}</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || loadError || !title.trim()} leftIcon={<Save className="w-4 h-4" />}>
            {usesApi ? t('courseEditorUi.saveDraft') : t('courseEditorUi.publish')}
          </Button>
        </div>
      </div>

      {usesApi && <p className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">{t('courseEditorUi.reviewNotice')}</p>}
      {usesApi && savedSuccess && <div className="p-4 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-semibold" role="status">{t('courseEditorUi.draftSaved')}</div>}
      {loadError && <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-lg" role="alert">{t('courseEditorUi.loadError')}</div>}
      {saveError && <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-lg" role="alert">{saveError}</div>}
      {!usesApi && savedSuccess && (
        <div className="p-4 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{t('courseEditorUi.published')}</span>
        </div>
      )}

      <div className="flex flex-wrap border-b border-slate-200 gap-6 text-xs font-semibold">
        <button type="button" onClick={() => setActiveTab('info')} className={tabClass('info')}>{t('courseEditorUi.tabInfo')}</button>
        <button type="button" onClick={() => setActiveTab('curriculum')} className={tabClass('curriculum')}>{t('courseEditorUi.tabCurriculum', { count: chapters.length })}</button>
        <button type="button" onClick={() => setActiveTab('pricing')} className={tabClass('pricing')}>{t('courseEditorUi.tabPricing')}</button>
        <button type="button" onClick={() => setActiveTab('certification')} className={tabClass('certification')}>{t('courseEditorUi.tabCertification')}</button>
      </div>

      {activeTab === 'info' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
          <FormField label={t('courseEditorUi.courseTitle')} required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required /></FormField>
          <FormField label={t('courseEditorUi.courseSubtitle')} required><Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={240} required /></FormField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={t('courseEditorUi.category')} required>
              <Select value={category} onChange={(e) => setCategory(e.target.value)} options={categoryOptions} />
            </FormField>
            <FormField label={t('courseEditorUi.level')} required>
              <Select value={level} onChange={(e) => setLevel(e.target.value as typeof level)}
                options={(['beginner', 'intermediate', 'advanced'] as const).map(value => ({ value, label: t(`common.levels.${value}`) }))} />
            </FormField>
          </div>
          <FormField label={t('courseEditorUi.description')} required><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={12000} required /></FormField>
          <FormField label={t('courseTeamUi.tags')} hint={t('courseTeamUi.tagsHint')}><Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} maxLength={600} /></FormField>
          {usesApi && <CourseTeachingSettings courseId={id} courseCode={courseCode} onCourseCode={setCourseCode} accessState={accessState} onAccessState={setAccessState} canManageAccess={canManageCommercial && !!id}
            settings={settings} onSettings={setSettings} datesInvalid={datesInvalid} banner={banner} onBanner={setBanner} bannerBusy={bannerBusy} onBannerBusy={setBannerBusy}
            syllabus={syllabus} onSyllabus={setSyllabus} />}
          {usesApi && id && <CoOwnersEditor courseId={id} coOwners={coOwners} editable={canManageCommercial} onChange={setCoOwners} />}
        </div>
      )}

      {activeTab === 'curriculum' && liveOutline && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-3">
          <p className="text-sm text-slate-700">{t('courseSettingsUi.outlineMoved', { modules: chapters.length, items: chapters.reduce((count, chapter) => count + chapter.lessons.length, 0) })}</p>
          <Link to={`/teacher/courses/${id}/content`} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"><LayoutList className="w-4 h-4" aria-hidden />{t('courseSettingsUi.openOutline')}</Link>
        </div>
      )}

      {activeTab === 'curriculum' && !liveOutline && (
        <div className="space-y-4">
          {assetError && <p role="alert" className="text-sm text-rose-600">{assetError}</p>}
          {usesApi && storageAccounts.length > 0 && (
            <label className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
              <span className="font-semibold">{t('storageUi.uploadTarget')}</span>
              <select className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs" value={storageTarget} onChange={event => setStorageTarget(event.target.value)}>
                <option value="default">{t('storageUi.targetDefault')}</option>
                <option value="local">{t('storageUi.targetLocal')}</option>
                {storageAccounts.filter(account => account.status === 'connected').map(account => <option key={account.id} value={account.id}>{t(`storageUi.providers.${account.provider}`)} · {account.accountEmail}</option>)}
              </select>
            </label>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">{t('courseEditorUi.curriculumHint')}</span>
            <Button variant="outline" size="sm" onClick={handleAddChapter} leftIcon={<Plus className="w-4 h-4" />}>{t('courseEditorUi.addChapter')}</Button>
          </div>
          <div className="space-y-4">
            {chapters.map(chapter => (
              <div key={chapter.id} className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
                <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <Input aria-label={t('courseEditorUi.chapterTitle')} value={chapter.title} maxLength={240} className="font-bold text-sm"
                    onChange={(e) => { const value = e.target.value; setChapters(prev => prev.map(item => item.id === chapter.id ? { ...item, title: value } : item)); }} />
                  <button type="button" aria-label={t('courseEditorUi.deleteChapter')} onClick={() => setChapters(prev => prev.filter(item => item.id !== chapter.id))} className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2 ps-4 border-s-2 border-indigo-100">
                  {chapter.lessons.map(lesson => (
                    <LessonEditor key={lesson.id} lesson={lesson} onChange={updated => updateLesson(chapter.id, updated)} onDelete={() => deleteLesson(chapter.id, lesson.id)}>
                      {usesApi && <div className="flex flex-wrap items-center gap-3">
                        {lesson.type === 'video' && <label className="text-indigo-700 font-medium cursor-pointer">
                          {assetBusy === `${lesson.id}:video` ? t('teacher.courseAssetUploading') : lesson.videoUrl?.startsWith('/courses/') ? t('teacher.replaceCourseVideo') : t('teacher.uploadCourseVideo')}
                          <input className="sr-only" type="file" accept="video/mp4,video/webm,.mp4,.webm" disabled={!id || Boolean(assetBusy)} onChange={event => { const file = event.target.files?.[0]; if (file) void handleAssetUpload(chapter.id, lesson.id, 'video', file); event.target.value = ''; }} />
                        </label>}
                        <label className="text-emerald-700 font-medium cursor-pointer">
                          {assetBusy === `${lesson.id}:resources` ? t('teacher.courseAssetUploading') : t('teacher.uploadLessonResource')}
                          <input className="sr-only" type="file" accept="application/pdf,application/zip,.pdf,.zip" disabled={!id || Boolean(assetBusy)} onChange={event => { const file = event.target.files?.[0]; if (file) void handleAssetUpload(chapter.id, lesson.id, 'resources', file); event.target.value = ''; }} />
                        </label>
                        {!id && <span className="text-slate-500">{t('teacher.courseSaveBeforeUpload')}</span>}
                      </div>}
                    </LessonEditor>
                  ))}
                  <Button variant="ghost" size="sm" onClick={() => handleAddLesson(chapter.id)} leftIcon={<Plus className="w-3.5 h-3.5" />}>{t('courseEditorUi.addLesson')}</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'pricing' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-800 block">{t('courseEditorUi.freeCourse')}</span>
              <span className="text-[11px] text-slate-500">{t('courseEditorUi.freeCourseHint')}</span>
            </div>
            <Switch checked={isFree} onChange={setIsFree} disabled={!canManageCommercial} />
          </div>
          {!canManageCommercial && <p role="note" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{t('courseTeamUi.pricingOwnerOnly')}</p>}
          {usesApi && (
            <fieldset className="space-y-2" disabled={!canManageCommercial}>
              <legend className="text-xs font-bold text-slate-800">{t('classesUi.visibility')}</legend>
              {(['public', 'restricted'] as const).map(value => (
                <label key={value} className="flex items-start gap-2 text-xs text-slate-700">
                  <input type="radio" name="course-visibility" className="mt-0.5" checked={visibility === value} onChange={() => setVisibility(value)} />
                  <span><span className="font-semibold block">{t(`classesUi.visibilityOptions.${value}`)}</span><span className="text-slate-500">{t(`classesUi.visibilityHints.${value}`)}</span></span>
                </label>
              ))}
            </fieldset>
          )}
          {!isFree && (
            <FormField label={t('courseEditorUi.price')} required>
              <Input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} min={5} max={500} required disabled={!canManageCommercial} />
            </FormField>
          )}
        </div>
      )}

      {activeTab === 'certification' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-800 block">{t('courseEditorUi.certificate')}</span>
              <span className="text-[11px] text-slate-500">{t('courseEditorUi.certificateHint')}</span>
            </div>
            <Switch checked={hasCertification} onChange={setHasCertification} />
          </div>
          {hasCertification && (
            <FormField label={t('courseEditorUi.pathway')}>
              <Select value={certPathway} onChange={(e) => setCertPathway(e.target.value as Pathway)}
                options={(['learning_and_quiz', 'online_exam', 'in_person_exam', 'both'] as const).map(value => ({ value, label: t(`courseEditorUi.pathways.${value}`) }))} />
            </FormField>
          )}
        </div>
      )}
    </div>
  );
};

/** Co-authors of an existing course (verified teachers by e-mail). Only the primary owner, its institution or an admin edits the list. */
const CoOwnersEditor: React.FC<{ courseId: string; coOwners: CoOwner[]; editable: boolean; onChange: (coOwners: CoOwner[]) => void }> = ({ courseId, coOwners, editable, onChange }) => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (emails: string[]) => {
    setBusy(true); setError('');
    try { onChange(await courseTeamApi.setCoOwners(courseId, emails)); setEmail(''); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
    finally { setBusy(false); }
  };
  return (
    <section className="pt-4 border-t border-slate-100 space-y-2" aria-labelledby="co-owners-title">
      <h3 id="co-owners-title" className="text-xs font-bold text-slate-800">{t('courseTeamUi.coOwners')}</h3>
      <p className="text-[11px] text-slate-500">{t('courseTeamUi.coOwnersHint')}</p>
      {coOwners.length === 0 && <p className="text-xs text-slate-500">{t('courseTeamUi.noCoOwners')}</p>}
      <ul className="space-y-1">
        {coOwners.map(owner => (
          <li key={owner.id} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-3 py-2 text-xs">
            <span>{owner.name} · {owner.email}</span>
            {editable && <Button size="sm" variant="ghost" className="text-rose-600" disabled={busy} onClick={() => void save(coOwners.filter(item => item.id !== owner.id).map(item => item.email))}>{t('courseTeamUi.remove')}</Button>}
          </li>
        ))}
      </ul>
      {editable && (
        <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void save([...coOwners.map(item => item.email), email.trim().toLowerCase()]); }}>
          <Input type="email" aria-label={t('courseTeamUi.coOwnerEmail')} placeholder={t('courseTeamUi.coOwnerEmail')} value={email} onChange={event => setEmail(event.target.value)} required className="max-w-xs" />
          <Button type="submit" size="sm" variant="outline" isLoading={busy} disabled={coOwners.length >= 10}>{t('courseTeamUi.add')}</Button>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    </section>
  );
};

// IANA zones offered for the course (publication and availability dates are read in this zone).
const TIME_ZONES: string[] = (() => {
  try { return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') || []; } catch { return []; }
})().filter(zone => /^(Africa|America|Asia|Atlantic|Australia|Europe|Indian|Pacific)\//.test(zone) || zone === 'UTC');

/** Teaching settings (Blackboard "Paramètres du cours"): identifier, access state, language, dates, notifications, banner, programme. */
const CourseTeachingSettings: React.FC<{
  courseId?: string; courseCode: string; onCourseCode: (value: string) => void;
  accessState: 'open' | 'private' | 'completed'; onAccessState: (value: 'open' | 'private' | 'completed') => void; canManageAccess: boolean;
  settings: CourseSettings; onSettings: (value: CourseSettings) => void; datesInvalid: boolean;
  banner: { assetId: string; alt: string; url: string }; onBanner: (value: { assetId: string; alt: string; url: string }) => void; bannerBusy: boolean; onBannerBusy: (value: boolean) => void;
  syllabus: CourseSyllabusEntry[]; onSyllabus: (value: CourseSyllabusEntry[]) => void;
}> = ({ courseId, courseCode, onCourseCode, accessState, onAccessState, canManageAccess, settings, onSettings, datesInvalid, banner, onBanner, bannerBusy, onBannerBusy, syllabus, onSyllabus }) => {
  const { t } = useTranslation();
  const [bannerError, setBannerError] = useState('');
  const updateEntry = (index: number, changes: Partial<CourseSyllabusEntry>) => onSyllabus(syllabus.map((entry, position) => position === index ? { ...entry, ...changes } : entry));
  return (
    <section className="pt-4 border-t border-slate-100 space-y-4" aria-labelledby="teaching-settings-title">
      <h3 id="teaching-settings-title" className="text-xs font-bold text-slate-800">{t('courseSettingsUi.title')}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <FormField label={t('courseSettingsUi.courseCode')} hint={t('courseSettingsUi.courseCodeHint')}><Input value={courseCode} maxLength={40} onChange={event => onCourseCode(event.target.value)} /></FormField>
        <FormField label={t('courseSettingsUi.language')}>
          <Select value={settings.language} onChange={event => onSettings({ ...settings, language: event.target.value as CourseSettings['language'] })}
            options={(['fr', 'en', 'ar'] as const).map(value => ({ value, label: t(`courseSettingsUi.languages.${value}`) }))} />
        </FormField>
        <FormField label={t('lmsSettings.timezone')} hint={t('lmsSettings.timezoneHint')}>
          <Select value={settings.timezone || ''} onChange={event => onSettings({ ...settings, timezone: event.target.value || null })}
            options={[{ value: '', label: t('lmsSettings.timezoneBrowser') }, ...TIME_ZONES.map(value => ({ value, label: value.replace(/_/g, ' ') }))]} />
        </FormField>
        <div className="flex items-center justify-between gap-3 text-xs sm:pt-6">
          <span className="font-semibold text-slate-800">{t('courseSettingsUi.notifyStudents')}</span>
          <Switch checked={settings.notifyStudents} onChange={value => onSettings({ ...settings, notifyStudents: value })} ariaLabel={t('courseSettingsUi.notifyStudents')} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label={t('courseSettingsUi.startsAt')}><Input type="datetime-local" value={toLocalInput(settings.startsAt)} onChange={event => onSettings({ ...settings, startsAt: fromLocalInput(event.target.value) })} /></FormField>
        <FormField label={t('courseSettingsUi.endsAt')} error={datesInvalid ? t('courseContentUi.invalidWindow') : undefined}><Input type="datetime-local" value={toLocalInput(settings.endsAt)} onChange={event => onSettings({ ...settings, endsAt: fromLocalInput(event.target.value) })} /></FormField>
      </div>
      {courseId && (
        <fieldset className="space-y-2" disabled={!canManageAccess}>
          <legend className="text-xs font-bold text-slate-800">{t('courseSettingsUi.accessState')}</legend>
          {(['open', 'private', 'completed'] as const).map(value => (
            <label key={value} className="flex items-start gap-2 text-xs text-slate-700">
              <input type="radio" name="course-access-state" className="mt-0.5" checked={accessState === value} onChange={() => onAccessState(value)} />
              <span><span className="font-semibold block">{t(`courseContentUi.accessStates.${value}`)}</span><span className="text-slate-500">{t(`courseSettingsUi.accessHints.${value}`)}</span></span>
            </label>
          ))}
          {!canManageAccess && <p className="text-[11px] text-amber-800">{t('courseTeamUi.pricingOwnerOnly')}</p>}
        </fieldset>
      )}
      {courseId && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-bold text-slate-800">{t('courseSettingsUi.banner')}</legend>
          <div className="flex flex-wrap items-center gap-3">
            {banner.url && <img src={apiAssetUrl(banner.url)} alt="" className="h-16 w-32 rounded object-cover border border-slate-200" />}
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-indigo-500">
              {bannerBusy ? t('blockUi.uploading') : t('courseSettingsUi.uploadBanner')}
              <input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp" disabled={bannerBusy} onChange={event => {
                const file = event.target.files?.[0]; event.target.value = '';
                if (!file) return;
                onBannerBusy(true); setBannerError('');
                courseContentApi.uploadMedia(courseId, 'image', file).then(asset => onBanner({ ...banner, assetId: asset.id, url: asset.url })).catch(() => setBannerError(t('blockUi.uploadError'))).finally(() => onBannerBusy(false));
              }} />
            </label>
            {banner.assetId && <Button type="button" variant="ghost" size="sm" onClick={() => onBanner({ assetId: '', alt: '', url: '' })}>{t('courseContentUi.removeThumbnail')}</Button>}
          </div>
          {banner.assetId && <FormField label={t('blockUi.altText')} required error={!banner.alt.trim() ? t('blockUi.issues.imageAlt') : undefined}><Input value={banner.alt} maxLength={300} onChange={event => onBanner({ ...banner, alt: event.target.value })} /></FormField>}
          <p className="text-[11px] text-slate-500">{t('courseSettingsUi.bannerHint')}</p>
          {bannerError && <p role="alert" className="text-xs text-rose-600">{bannerError}</p>}
        </fieldset>
      )}
      <fieldset className="space-y-2">
        <legend className="text-xs font-bold text-slate-800">{t('courseSettingsUi.syllabus')}</legend>
        <p className="text-[11px] text-slate-500">{t('courseSettingsUi.syllabusHint')}</p>
        {syllabus.map((entry, index) => (
          <div key={entry.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 rounded-lg bg-slate-50 p-2">
            <FormField label={t('courseSettingsUi.sessionTitle')} required className="sm:col-span-5"><Input value={entry.title} maxLength={240} onChange={event => updateEntry(index, { title: event.target.value })} /></FormField>
            <FormField label={t('courseSettingsUi.sessionStart')} required className="sm:col-span-4"><Input type="datetime-local" value={toLocalInput(entry.startsAt)} onChange={event => updateEntry(index, { startsAt: fromLocalInput(event.target.value) || '' })} /></FormField>
            <FormField label={t('courseSettingsUi.sessionDuration')} className="sm:col-span-2"><Input type="number" min={0} max={1440} value={entry.durationMinutes} onChange={event => updateEntry(index, { durationMinutes: Math.min(1440, Math.max(0, Number(event.target.value) || 0)) })} /></FormField>
            <div className="sm:col-span-1 flex items-end justify-end">
              <button type="button" className="p-2 text-slate-400 hover:text-rose-600" aria-label={t('courseSettingsUi.removeSession', { title: entry.title || index + 1 })} onClick={() => onSyllabus(syllabus.filter((_, position) => position !== index))}><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} disabled={syllabus.length >= 200}
          onClick={() => onSyllabus([...syllabus, { id: `s_${Date.now().toString(36)}`, title: '', startsAt: '', durationMinutes: 90 }])}>{t('courseSettingsUi.addSession')}</Button>
      </fieldset>
    </section>
  );
};
