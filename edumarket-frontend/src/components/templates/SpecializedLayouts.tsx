import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Menu, X, ShieldAlert, Clock, AlertTriangle } from 'lucide-react';
import { LanguageSwitcher } from '../atoms/LanguageSwitcher';
import { Button } from '../atoms/Button';

export const CourseLearningLayout: React.FC<{
  courseTitle: string;
  courseId: string;
  progressPercent: number;
  sidebar: React.ReactNode;
  children: React.ReactNode;
}> = ({ courseTitle, courseId, progressPercent, sidebar, children }) => {
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-white overflow-hidden">
      {/* Learning Top Bar */}
      <header className="h-14 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <Link
            to={`/courses/${courseId}`}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4 rtl-flip" />
            <span className="hidden sm:inline">{t('learning.backToCourse')}</span>
          </Link>
          <span className="text-slate-600">|</span>
          <h2 className="text-xs sm:text-sm font-semibold text-slate-200 truncate max-w-xs sm:max-w-md">
            {courseTitle}
          </h2>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2">
            <span className="text-xs text-slate-400">{t('learning.courseProgress')}</span>
            <span className="text-xs font-bold text-indigo-400 tabular-nums">{progressPercent}%</span>
            <div className="w-24 bg-slate-800 rounded-full h-1.5">
              <div
                className="bg-indigo-500 h-1.5 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <LanguageSwitcher variant="minimal" />

          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={t('chromeUi.toggleCourseOutline')}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Main Body with collapsible syllabus */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main Stage */}
        <main className="flex-1 overflow-y-auto bg-slate-900 p-4 sm:p-6 lg:p-8">
          <div className="max-w-4xl mx-auto">
            {children}
          </div>
        </main>

        {/* Syllabus Sidebar */}
        {sidebarOpen && (
          <aside className="w-80 bg-slate-950 border-s border-slate-800 flex flex-col h-full shrink-0 overflow-y-auto">
            {sidebar}
          </aside>
        )}
      </div>
    </div>
  );
};

export const ExamLayout: React.FC<{
  examTitle: string;
  timeRemainingSeconds: number;
  onFinishExam: () => void;
  children: React.ReactNode;
}> = ({ examTitle, timeRemainingSeconds, onFinishExam, children }) => {
  const { t } = useTranslation();

  const minutes = Math.floor(timeRemainingSeconds / 60);
  const seconds = timeRemainingSeconds % 60;
  const isTimeCritical = timeRemainingSeconds < 300; // less than 5 min

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900 select-none">
      <header className="sticky top-0 z-40 bg-slate-900 text-white border-b border-slate-800 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-rose-600 flex items-center justify-center text-white">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white truncate max-w-sm sm:max-w-md">
              {examTitle}
            </h1>
            <span className="text-[11px] text-slate-400">
              {t('chromeUi.examSessionBanner')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border font-mono font-bold text-sm tabular-nums ${
            isTimeCritical 
              ? 'bg-rose-950/80 border-rose-500 text-rose-300 animate-pulse' 
              : 'bg-slate-800 border-slate-700 text-amber-400'
          }`}>
            <Clock className="w-4 h-4" />
            <span>
              {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </span>
          </div>

          <Button variant="danger" size="sm" onClick={onFinishExam}>
            {t('learning.submitQuiz')}
          </Button>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
};

export const ErrorLayout: React.FC<{
  code: string;
  title: string;
  description: string;
  onRetry?: () => void;
}> = ({ code, title, description, onRetry }) => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50 text-slate-900 text-center">
      <div className="w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mb-6">
        <AlertTriangle className="w-8 h-8" />
      </div>
      <span className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400 mb-2">
        Code {code}
      </span>
      <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-3">
        {title}
      </h1>
      <p className="text-sm text-slate-600 max-w-md mb-8 leading-relaxed">
        {description}
      </p>
      <div className="flex items-center gap-3">
        <Link to="/">
          <Button variant="primary">
            {t('errors.backToHome')}
          </Button>
        </Link>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            {t('chromeUi.retry')}
          </Button>
        )}
      </div>
    </div>
  );
};
