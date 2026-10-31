import React from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock } from 'lucide-react';
import { Button } from '../atoms/Button';
import type { ScheduleSuggestion } from '../../utils/scheduleDetection';
import { formatRange } from './EventDialog';

interface Props {
  suggestion: ScheduleSuggestion;
  canProposeSession: boolean;
  sessionLabel: string;
  onCreateEvent: () => void;
  onSession: () => void;
  onDismiss: () => void;
}

/** Discreet suggestion under a chat message; it never creates anything by itself. */
export const ScheduleSuggestionCard: React.FC<Props> = ({ suggestion, canProposeSession, sessionLabel, onCreateEvent, onSession, onDismiss }) => {
  const { t, i18n } = useTranslation();
  const when = formatRange(suggestion.start, suggestion.end, i18n.language, suggestion.timeZone);
  return (
    <div role="group" aria-label={t('chatSchedule.label')} className="mt-1 max-w-[75%] rounded-lg border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-950">
      <p className="flex items-start gap-1.5">
        <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          {t('chatSchedule.detected')} <strong>{when}</strong>
          {!suggestion.endTime && <span className="block text-indigo-800">{t('chatSchedule.noEnd')}</span>}
          {suggestion.ambiguous && <span className="block text-amber-800">{t('chatSchedule.checkDate')}</span>}
          {suggestion.otherCount > 0 && <span className="block text-indigo-800">{t('chatSchedule.others', { count: suggestion.otherCount })}</span>}
        </span>
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Button size="sm" variant="primary" onClick={onCreateEvent}>{t('chatSchedule.createEvent')}</Button>
        {canProposeSession && <Button size="sm" variant="outline" onClick={onSession}>{sessionLabel}</Button>}
        <Button size="sm" variant="ghost" onClick={onDismiss}>{t('chatSchedule.ignore')}</Button>
      </div>
    </div>
  );
};
