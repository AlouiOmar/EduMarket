import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../components/atoms/Button';
import { Input } from '../../../components/atoms/Input';
import { FormField } from '../../../components/molecules/FormField';
import { ErrorAlert, LoadingState } from '../../../components/molecules/PageStates';
import { LmsDialog } from '../../../components/organisms/LmsShared';
import { assessmentApi, type Rubric, type RubricInput } from '../../../services/assessmentService';
import { apiErrorMessage } from '../../../utils/apiErrors';

const uid = () => Math.random().toString(36).slice(2, 10);
const emptyRubric = (): RubricInput => ({ title: '', visibleToStudents: true, criteria: [{ id: uid(), title: '', description: '', levels: [{ id: uid(), title: '', points: 0, description: '' }, { id: uid(), title: '', points: 5, description: '' }] }] });

/** Rubric table (criteria × levels); the score is the sum of selected levels scaled to the assignment points. */
export const RubricTable: React.FC<{ rubric: Rubric; selected?: Record<string, string>; onSelect?: (criterionId: string, levelId: string) => void }> = ({ rubric, selected, onSelect }) => {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border border-slate-200 text-xs">
        <caption className="sr-only">{t('assessmentUi.rubricCaption', { title: rubric.title })}</caption>
        <tbody>
          {rubric.criteria.map(criterion => (
            <tr key={criterion.id} className="border-t border-slate-200">
              <th scope="row" className="w-40 bg-slate-50 px-2 py-2 text-start font-semibold text-slate-800">{criterion.title}{criterion.description && <span className="block font-normal text-slate-500">{criterion.description}</span>}</th>
              {criterion.levels.map(level => {
                const active = selected?.[criterion.id] === level.id;
                const content = <><span className="font-semibold">{level.title}</span> · {t('assessmentUi.pointsCount', { count: level.points })}{level.description && <span className="block text-slate-500">{level.description}</span>}</>;
                return (
                  <td key={level.id} className="border-s border-slate-200 p-1 align-top">
                    {onSelect
                      ? <button type="button" aria-pressed={active} onClick={() => onSelect(criterion.id, level.id)} className={`w-full rounded px-2 py-1.5 text-start ${active ? 'bg-indigo-600 text-white' : 'hover:bg-indigo-50'}`}>{content}</button>
                      : <div className="px-2 py-1.5">{content}</div>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const RubricsPanel: React.FC<{ courseId: string }> = ({ courseId }) => {
  const { t } = useTranslation();
  const [rubrics, setRubrics] = useState<Rubric[] | null>(null);
  const [editing, setEditing] = useState<{ id?: string; input: RubricInput } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => assessmentApi.rubrics(courseId).then(setRubrics).catch(cause => setError(apiErrorMessage(t, cause))), [courseId, t]);
  useEffect(() => { void load(); }, [load]);
  if (!rubrics) return error ? <ErrorAlert message={error} /> : <LoadingState />;
  return (
    <div className="mt-4 space-y-3">
      <div className="flex justify-end"><Button size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setEditing({ input: emptyRubric() })}>{t('assessmentUi.createRubric')}</Button></div>
      <ErrorAlert message={error} />
      {rubrics.map(rubric => (
        <section key={rubric.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4" aria-label={rubric.title}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{rubric.title} <span className="font-normal text-slate-500">· {t('assessmentUi.pointsCount', { count: rubric.maxPoints })}{rubric.visibleToStudents ? ` · ${t('assessmentUi.visibleToStudents')}` : ''}</span></h3>
            <Button size="sm" variant="outline" leftIcon={<Pencil className="w-3.5 h-3.5" />} onClick={() => { const { id, maxPoints: _max, ...input } = rubric; setEditing({ id, input }); }}>{t('lmsCommon.edit')}</Button>
          </div>
          <RubricTable rubric={rubric} />
        </section>
      ))}
      {!rubrics.length && <p className="text-sm text-slate-500">{t('assessmentUi.noRubrics')}</p>}
      {editing && <RubricDialog courseId={courseId} editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    </div>
  );
};

const RubricDialog: React.FC<{ courseId: string; editing: { id?: string; input: RubricInput }; onClose: () => void; onSaved: () => void }> = ({ courseId, editing, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [input, setInput] = useState<RubricInput>(editing.input);
  const [error, setError] = useState('');
  const setCriterion = (id: string, changes: Partial<RubricInput['criteria'][number]>) => setInput(current => ({ ...current, criteria: current.criteria.map(criterion => criterion.id === id ? { ...criterion, ...changes } : criterion) }));
  const save = async () => {
    setError('');
    try { if (editing.id) await assessmentApi.updateRubric(courseId, editing.id, input); else await assessmentApi.createRubric(courseId, input); onSaved(); }
    catch (cause) { setError(apiErrorMessage(t, cause)); }
  };
  const valid = input.title.trim() && input.criteria.every(criterion => criterion.title.trim() && criterion.levels.length >= 2 && criterion.levels.every(level => level.title.trim()));
  return (
    <LmsDialog title={editing.id ? t('assessmentUi.editRubric') : t('assessmentUi.createRubric')} onClose={onClose} wide>
      <FormField label={t('assessmentUi.rubricTitle')} required><Input value={input.title} maxLength={200} onChange={event => setInput({ ...input, title: event.target.value })} /></FormField>
      <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={input.visibleToStudents} onChange={event => setInput({ ...input, visibleToStudents: event.target.checked })} />{t('assessmentUi.visibleBeforeSubmission')}</label>
      {input.criteria.map((criterion, index) => (
        <fieldset key={criterion.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-700">{t('assessmentUi.criterionLabel', { index: index + 1 })}</legend>
          <div className="flex items-end gap-2">
            <FormField label={t('assessmentUi.criterionTitle')} className="flex-1"><Input value={criterion.title} maxLength={200} onChange={event => setCriterion(criterion.id, { title: event.target.value })} /></FormField>
            <Button size="sm" variant="ghost" disabled={input.criteria.length <= 1} aria-label={t('assessmentUi.removeCriterion', { index: index + 1 })} onClick={() => setInput({ ...input, criteria: input.criteria.filter(candidate => candidate.id !== criterion.id) })}><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
          {criterion.levels.map((level, levelIndex) => (
            <div key={level.id} className="flex items-end gap-2">
              <FormField label={t('assessmentUi.levelTitle', { index: levelIndex + 1 })} className="flex-1"><Input value={level.title} maxLength={200} onChange={event => setCriterion(criterion.id, { levels: criterion.levels.map(candidate => candidate.id === level.id ? { ...candidate, title: event.target.value } : candidate) })} /></FormField>
              <FormField label={t('assessmentUi.points')} className="w-24"><Input type="number" min={0} value={level.points} onChange={event => setCriterion(criterion.id, { levels: criterion.levels.map(candidate => candidate.id === level.id ? { ...candidate, points: Math.max(0, Number(event.target.value) || 0) } : candidate) })} /></FormField>
              <Button size="sm" variant="ghost" disabled={criterion.levels.length <= 2} aria-label={t('assessmentUi.removeLevel', { index: levelIndex + 1 })} onClick={() => setCriterion(criterion.id, { levels: criterion.levels.filter(candidate => candidate.id !== level.id) })}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" disabled={criterion.levels.length >= 10} onClick={() => setCriterion(criterion.id, { levels: [...criterion.levels, { id: uid(), title: '', points: 0, description: '' }] })}>{t('assessmentUi.addLevel')}</Button>
        </fieldset>
      ))}
      <Button size="sm" variant="outline" onClick={() => setInput({ ...input, criteria: [...input.criteria, emptyRubric().criteria[0]] })}>{t('assessmentUi.addCriterion')}</Button>
      <ErrorAlert message={error} />
      <div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={onClose}>{t('lmsCommon.cancel')}</Button><Button size="sm" disabled={!valid} onClick={() => void save()}>{t('lmsCommon.save')}</Button></div>
    </LmsDialog>
  );
};
