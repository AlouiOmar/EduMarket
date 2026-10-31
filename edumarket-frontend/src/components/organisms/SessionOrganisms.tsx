import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Video,
  Mic, 
  MicOff, 
  Camera, 
  CameraOff, 
  PhoneOff
} from 'lucide-react';
import { TutoringSession } from '../../types';
import { sessionService } from '../../services/sessionService';
import { Button } from '../atoms/Button';
import { Badge } from '../atoms/Badge';
import { Avatar } from '../atoms/Avatar';
import { FormField } from '../molecules/FormField';
import { Input } from '../atoms/Input';
import { Textarea } from '../atoms/Textarea';
import { Select } from '../atoms/Select';

export const SessionBookingForm: React.FC<{
  teacherId?: string;
  onBook: (data: { slotId: string; subject: string; notes?: string }) => void;
  onCancel?: () => void;
}> = ({
  teacherId,
  onBook,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [slots, setSlots] = useState<(TutoringSession & { slotId: string })[]>([]);
  const [slotId, setSlotId] = useState('');
  const [error, setError] = useState('');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => { sessionService.getAvailability().then(result => { const available = teacherId ? result.data.filter(slot => slot.teacherId === teacherId) : result.data; setSlots(available); setSlotId(available[0]?.slotId || ''); }).catch(() => setError(t('chromeUi.availabilityError'))); }, [teacherId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const chosen = slots.find(slot => slot.slotId === slotId);
    if (chosen) onBook({ slotId: chosen.slotId, subject: subject || t('chromeUi.defaultSubject'), notes });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div>
          <h3 className="text-base font-bold text-slate-900">{t('sessions.bookSession')}</h3>
          <p className="text-xs text-slate-500">{t('chromeUi.bookingHint')}</p>
        </div>
      </div>

      <FormField label={t('sessions.selectDateTime')}>
        <Select value={slotId} onChange={e => setSlotId(e.target.value)} required options={[{ value: '', label: t('chromeUi.selectSlot') }, ...slots.map(slot => ({ value: slot.slotId, label: `${slot.date} · ${slot.startTime}–${slot.endTime} · ${slot.teacherName} · ${slot.price} € · ${slot.type === 'online' ? t('chromeUi.slotOnline') : t('chromeUi.slotInPerson')}` }))]} />
        {slots.length === 0 && <p className="text-xs text-slate-500 mt-2">{t('chromeUi.noSlots')}</p>}
      </FormField>

      <FormField label={t('chromeUi.sessionSubject')}>
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t('chromeUi.subjectPlaceholder')}
          required
        />
      </FormField>

      <FormField label={t('chromeUi.sessionNotes')}>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('chromeUi.notesPlaceholder')}
          rows={3}
        />
      </FormField>

      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
        {onCancel && (
          <Button variant="outline" size="sm" type="button" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <Button variant="primary" size="sm" type="submit" disabled={!slotId}>
          {t('sessions.confirmBooking')}
        </Button>
      </div>
    </form>
  );
};

export const JitsiMeetingRoom: React.FC<{
  roomId: string;
  sessionTitle: string;
  onLeave: () => void;
}> = ({ roomId, sessionTitle, onLeave }) => {
  const { t } = useTranslation();
  const [micActive, setMicActive] = useState(true);
  const [cameraActive, setCameraActive] = useState(true);

  return (
    <div className="bg-slate-950 text-white rounded-2xl overflow-hidden border border-slate-800 shadow-2xl flex flex-col h-[520px]">
      <div className="p-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold text-slate-200">{sessionTitle}</span>
          <span className="text-[11px] text-slate-500 font-mono">Room #{roomId}</span>
        </div>
        <span className="text-xs text-amber-400 font-medium">{t('chromeUi.jitsiNotConfigured')}</span>
      </div>

      <div className="flex-1 bg-slate-900 flex items-center justify-center p-6 relative">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full h-full max-w-3xl">
          <div className="bg-slate-800 rounded-xl flex flex-col items-center justify-center p-6 relative overflow-hidden border border-slate-700">
            <Avatar alt={t('chromeUi.participant')} size="lg" className="mb-3" />
            <span className="text-xs font-bold text-white">{t('chromeUi.meetingRoom')}</span>
            <div className="absolute bottom-3 start-3 flex items-center gap-1.5 text-[10px] text-emerald-400 bg-slate-900/80 px-2 py-0.5 rounded">
              <Mic className="w-3 h-3" /> {t('chromeUi.connected')}
            </div>
          </div>

          <div className="bg-slate-800 rounded-xl flex flex-col items-center justify-center p-6 relative overflow-hidden border border-slate-700">
            <Avatar alt={t('chromeUi.participant')} size="lg" className="mb-3" />
            <span className="text-xs font-bold text-white">{t('chromeUi.videoDisconnected')}</span>
            <div className="absolute bottom-3 start-3 flex items-center gap-1.5 text-[10px] text-emerald-400 bg-slate-900/80 px-2 py-0.5 rounded">
              <Mic className="w-3 h-3" /> {t('chromeUi.online')}
            </div>
          </div>
        </div>
      </div>

      {/* Conference toolbar */}
      <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-center gap-4">
        <button
          onClick={() => setMicActive(!micActive)}
          aria-label={micActive ? t('chromeUi.muteMic') : t('chromeUi.unmuteMic')}
          className={`p-3 rounded-full transition-colors ${micActive ? 'bg-slate-800 hover:bg-slate-700 text-white' : 'bg-rose-600 text-white'}`}
        >
          {micActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
        </button>
        <button
          onClick={() => setCameraActive(!cameraActive)}
          aria-label={cameraActive ? t('chromeUi.cameraOff') : t('chromeUi.cameraOn')}
          className={`p-3 rounded-full transition-colors ${cameraActive ? 'bg-slate-800 hover:bg-slate-700 text-white' : 'bg-rose-600 text-white'}`}
        >
          {cameraActive ? <Camera className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
        </button>
        <button
          onClick={onLeave}
          aria-label={t('chromeUi.leaveMeeting')}
          className="p-3 rounded-full bg-rose-600 hover:bg-rose-700 text-white transition-colors"
        >
          <PhoneOff className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
