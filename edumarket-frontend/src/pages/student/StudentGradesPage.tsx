import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/atoms/Badge';
import { ErrorAlert, LoadingState } from '../../components/molecules/PageStates';
import { StudentCourseFrame, formatScore } from '../../components/organisms/LmsShared';
import { gradebookApi, type StudentGrades } from '../../services/gradebookService';
import { apiErrorMessage } from '../../utils/apiErrors';
import { formatDateTime } from '../../utils/format';

/** Student grades: published grades and feedback only, totals computed on published grades ("—" when nothing is published). */
export const StudentGradesPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const [grades, setGrades] = useState<StudentGrades | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { gradebookApi.mine(id).then(setGrades).catch(cause => setError(apiErrorMessage(t, cause))); }, [id, t]);

  return (
    <StudentCourseFrame courseId={id} title={t('gradebookUi.myGrades')} subtitle={t('gradebookUi.myGradesHint')}>
      <ErrorAlert message={error} />
      {!grades ? (!error && <LoadingState />) : (
        <>
          <section aria-labelledby="grades-total" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <h2 id="grades-total" className="sr-only">{t('gradebookUi.total')}</h2>
            <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{t('gradebookUi.overall20')}</p><p className="text-2xl font-bold text-slate-900">{formatScore(grades.totals.outOf20, i18n.language)}</p></div>
            <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{t('gradebookUi.overallPercent')}</p><p className="text-2xl font-bold text-slate-900">{grades.totals.percent === null ? '—' : `${formatScore(grades.totals.percent, i18n.language)} %`}</p></div>
            {grades.totals.categories.filter(category => category.percent !== null).slice(0, 2).map(category => (
              <div key={category.categoryId} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{category.name}</p><p className="text-2xl font-bold text-slate-900">{formatScore(category.percent, i18n.language)} %</p></div>
            ))}
          </section>
          {grades.categories.map(category => {
            const columns = grades.columns.filter(column => column.categoryId === category.id);
            if (!columns.length) return null;
            return (
              <section key={category.id} aria-labelledby={`cat-${category.id}`} className="rounded-xl border border-slate-200 bg-white">
                <h2 id={`cat-${category.id}`} className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-900">{category.name}</h2>
                <ul className="divide-y divide-slate-100">
                  {columns.map(column => (
                    <li key={column.id} className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 px-4 py-3 text-sm">
                      <div>
                        <p className="font-medium text-slate-800">{column.title}</p>
                        {column.dueAt && <p className="text-xs text-slate-500">{t('gradebookUi.dueOn', { date: formatDateTime(column.dueAt, i18n.language) })}</p>}
                        {column.feedback && <p className="mt-1 whitespace-pre-line text-xs text-slate-700"><span className="font-semibold">{t('gradebookUi.feedback')} : </span>{column.feedback}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {column.status === 'published'
                          ? <span className="font-semibold text-slate-900">{column.excused ? t('gradebookUi.excused') : `${formatScore(column.score, i18n.language)} / ${column.maxPoints}`}</span>
                          : <Badge size="sm" variant={column.status === 'pending' ? 'warning' : 'default'}>{t(`gradebookUi.studentStatus.${column.status}`)}</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {grades.columns.length === 0 && <p className="text-sm text-slate-500">{t('gradebookUi.nothingYet')}</p>}
        </>
      )}
    </StudentCourseFrame>
  );
};
