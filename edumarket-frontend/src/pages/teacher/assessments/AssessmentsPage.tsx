import React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TeacherCourseFrame } from '../../../components/organisms/LmsShared';
import { BanksPanel } from './BanksPanel';
import { TestsPanel } from './TestsPanel';
import { RubricsPanel } from './RubricsPanel';
import { AssignmentsPanel } from './AssignmentsPanel';
import { FormsPanel } from './FormsPanel';

const TABS = ['tests', 'banks', 'assignments', 'rubrics', 'forms'] as const;
type Tab = typeof TABS[number];

/** Course assessments: tests, question banks, assignments, rubrics and forms (tab kept in the URL). */
export const AssessmentsPage: React.FC = () => {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get('tab') || '') ? params.get('tab') as Tab : 'tests';
  return (
    <TeacherCourseFrame courseId={id} title={t('assessmentUi.title')} subtitle={t('assessmentUi.subtitle')}>
      <div role="tablist" aria-label={t('assessmentUi.title')} className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map(key => (
          <button key={key} id={`tab-${key}`} role="tab" type="button" aria-selected={tab === key} aria-controls={`panel-${key}`} tabIndex={tab === key ? 0 : -1}
            onClick={() => setParams({ tab: key }, { replace: true })}
            onKeyDown={event => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
              const next = TABS[(TABS.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
              setParams({ tab: next }, { replace: true });
              window.setTimeout(() => document.getElementById(`tab-${next}`)?.focus(), 0);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-semibold ${tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
            {t(`assessmentUi.tabs.${key}`)}
          </button>
        ))}
      </div>
      <section id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'tests' && <TestsPanel courseId={id} />}
        {tab === 'banks' && <BanksPanel courseId={id} />}
        {tab === 'assignments' && <AssignmentsPanel courseId={id} />}
        {tab === 'rubrics' && <RubricsPanel courseId={id} />}
        {tab === 'forms' && <FormsPanel courseId={id} />}
      </section>
    </TeacherCourseFrame>
  );
};
