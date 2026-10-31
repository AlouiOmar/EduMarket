import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Conversation, Message, User } from '../../types';
import { messagingService } from '../../services/messagingService';
import { sessionService } from '../../services/sessionService';
import { useAuth } from '../../contexts/AuthContext';
import { ChatWindow } from '../../components/organisms/ChatWindow';
import { SearchField } from '../../components/molecules/SearchField';
import { Avatar } from '../../components/atoms/Avatar';
import { SessionBookingForm } from '../../components/organisms/SessionOrganisms';
import { Button } from '../../components/atoms/Button';
import { EventDialog, formatRange, type EventDraft } from '../../components/calendar/EventDialog';
import { ScheduleSuggestionCard } from '../../components/calendar/ScheduleSuggestionCard';
import { calendarService, type CalendarConnection } from '../../services/calendarService';
import { suggestSchedule, type ScheduleSuggestion } from '../../utils/scheduleDetection';
import { browserTimeZone } from '../../utils/timeZone';

const DISMISSED_KEY = 'edumarket.chatSchedule.dismissed';
const readDismissed = () => { try { return new Set<string>(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')); } catch { return new Set<string>(); } };

export const ApiMessagingPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [showBooking, setShowBooking] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const [scheduling, setScheduling] = useState<{ draft: EventDraft; connections: CalendarConnection[]; duration: number } | null>(null);
  const [scheduleNotice, setScheduleNotice] = useState('');
  const [timeZone, setTimeZone] = useState(browserTimeZone());
  useEffect(() => { calendarService.preferences().then(preferences => { if (preferences.timeZone) setTimeZone(preferences.timeZone); }).catch(() => undefined); }, []);

  const refreshConversations = async () => {
    const result = await messagingService.listConversations();
    setConversations(result.data);
    if (!activeId && result.data[0]) setActiveId(result.data[0].id);
  };
  useEffect(() => { void refreshConversations().catch(() => setError(t('messaging.loadError'))); }, []);
  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    let active = true;
    const refresh = async () => {
      try {
        const result = await messagingService.listMessages(activeId);
        if (active) setMessages(result.data);
        await messagingService.markRead(activeId);
        if (active) await refreshConversations();
      } catch { if (active) setError(t('messaging.conversationError')); }
    };
    void refresh();
    const eventSource = messagingService.connectToMessageEvents(event => {
      if (event.conversationId === activeId) void refresh();
      else void refreshConversations().catch(() => { if (active) setError(t('messaging.loadError')); });
    });
    let fallbackTimer: number | undefined;
    eventSource.onerror = () => {
      eventSource.close();
      if (active && fallbackTimer === undefined) fallbackTimer = window.setInterval(() => void refresh(), 15_000);
    };
    return () => { active = false; eventSource.close(); if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer); };
  }, [activeId]);

  const activeConversation = conversations.find(conversation => conversation.id === activeId);
  // Local detection only (no network): the recent messages, read in the reader's time zone, from each message's own timestamp.
  const suggestions = useMemo(() => {
    const now = new Date();
    const result = new Map<string, ScheduleSuggestion>();
    for (const message of messages.slice(-50)) {
      if (!message.text || message.hidden || dismissed.has(message.id)) continue;
      const suggestion = suggestSchedule(message.text, { reference: new Date(message.timestamp), now, timeZone });
      if (suggestion) result.set(message.id, suggestion);
    }
    return result;
  }, [messages, dismissed, timeZone]);
  const dismiss = (messageId: string) => setDismissed(previous => {
    const next = new Set(previous); next.add(messageId);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next].slice(-500))); } catch { /* per-device convenience only */ }
    return next;
  });
  const recipient = activeConversation?.participants.find(participant => participant.id !== user?.id);
  const displayRecipient: User = recipient || { id: '', name: 'Conversation', email: '', avatar: '', role: 'student', status: 'active', joinedDate: '' };
  const filtered = conversations.filter(conversation => {
    const other = conversation.participants.find(participant => participant.id !== user?.id);
    return (other?.name || '').toLowerCase().includes(search.toLowerCase());
  });
  const appendMessage = (message: Message) => setMessages(prev => prev.some(existing => existing.id === message.id) ? prev : [...prev, message]);

  const createConversation = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    try {
      const conversation = await messagingService.createConversation(email);
      setConversations(prev => [conversation, ...prev.filter(item => item.id !== conversation.id)]);
      setActiveId(conversation.id); setEmail('');
    } catch (cause) { setError((cause as { code?: string }).code === 'CONTACT_NOT_FOUND' ? t('messaging.noEligibleContact') : t('messaging.conversationError')); }
  };
  const sendMessage = async (text: string, voiceUrl?: string, attachment?: { name: string; size: string; url: string }) => {
    if (!activeId || voiceUrl || attachment) return;
    try {
      const message = await messagingService.sendText(activeId, text);
      appendMessage(message); setError(''); await refreshConversations();
    } catch { setError(t('messaging.sendError')); }
  };
  const uploadAttachment = async (file: File) => {
    if (!activeId) return;
    try {
      const message = await messagingService.sendAttachment(activeId, file);
      appendMessage(message); setError(''); await refreshConversations();
    } catch { setError(t('messaging.attachmentError')); }
  };
  const downloadAttachment = async (attachment: { name: string; size: string; url: string }) => {
    try { await messagingService.downloadAttachment(attachment); }
    catch { setError(t('messaging.attachmentError')); }
  };
  const uploadVoiceNote = async (voice: Blob, durationSeconds: number) => {
    if (!activeId) return;
    try {
      const message = await messagingService.sendVoiceNote(activeId, voice, durationSeconds);
      appendMessage(message); setError(''); await refreshConversations();
    } catch { setError(t('messaging.voiceError')); }
  };
  const openScheduling = async (message: Message, suggestion: ScheduleSuggestion, asSession: boolean) => {
    const other = activeConversation?.participants.find(participant => participant.id !== user?.id);
    const [connections, preferences] = await Promise.all([calendarService.connections().catch(() => []), calendarService.preferences().catch(() => null)]);
    const duration = preferences?.defaultDurationMinutes || 60;
    const kind = asSession ? 'session' : suggestion.kind === 'appointment' ? 'appointment' : 'meeting';
    const title = t(`chatSchedule.titles.${suggestion.kind}`) + (suggestion.topic ? ` — ${suggestion.topic}` : '');
    const notices = [
      !suggestion.endTime ? t('chatSchedule.defaultEndNotice', { minutes: duration }) : '',
      suggestion.ambiguous ? t('chatSchedule.ambiguousNotice', { date: formatRange(suggestion.start, null, i18n.language, suggestion.timeZone) }) : '',
    ].filter(Boolean);
    setScheduling({ connections, duration, draft: {
      start: suggestion.start, end: suggestion.end, timeZone: suggestion.timeZone, kind, title,
      description: t('chatSchedule.fromMessage', { name: message.senderId === user?.id ? t('chatSchedule.you') : other?.name || '', text: (message.text || '').slice(0, 300) }),
      mode: suggestion.kind === 'call' ? 'online' : 'none', sourceMessageId: message.id, notices,
      // Shown as a suggestion in the form, never added without the user's action.
      suggestedParticipants: other ? [{ id: other.id, name: other.name, role: other.role }] : [],
      teacherId: asSession && user?.role === 'student' ? other?.id : undefined,
    } });
  };
  const bookSession = async (data: { slotId: string; subject: string; notes?: string }) => {
    try { await sessionService.bookSession(data); setShowBooking(false); navigate('/sessions'); }
    catch { setError(t('messaging.bookingError')); }
  };

  return <div className="max-w-6xl mx-auto space-y-6">
    <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('messaging.inbox')}</h1><p className="text-xs text-slate-500 mt-1">{t('messaging.privateDescription')}</p></div>
    <form onSubmit={createConversation} className="flex flex-col sm:flex-row gap-2">
      <input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder={user?.role === 'student' ? t('messaging.teacherEmail') : t('messaging.studentEmail')} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <Button type="submit" variant="primary" size="sm">{t('messaging.startConversation')}</Button>
    </form>
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
      <div className="md:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="p-3 border-b border-slate-200"><SearchField value={search} onChange={setSearch} placeholder={t('messaging.searchConversations')} /></div>
        <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
          {filtered.map(conversation => {
            const other = conversation.participants.find(participant => participant.id !== user?.id);
            return <button key={conversation.id} onClick={() => setActiveId(conversation.id)} className={`w-full p-4 flex items-start gap-3 text-start ${conversation.id === activeId ? 'bg-indigo-50/80' : 'hover:bg-slate-50'}`}>
              <Avatar src={other?.avatar} alt={other?.name || ''} size="md" />
              <div className="flex-1 truncate"><span className="text-xs font-bold text-slate-900">{other?.name}</span><p className="text-xs text-slate-500 truncate">{conversation.lastMessage.text}</p></div>
              {conversation.unreadCount > 0 && <span className="rounded-full bg-indigo-600 text-white text-[10px] px-2 py-0.5">{conversation.unreadCount}</span>}
            </button>;
          })}
          {filtered.length === 0 && <p className="p-5 text-xs text-slate-500">{t('messaging.noConversations')}</p>}
        </div>
      </div>
      <div className="md:col-span-8">
        {activeConversation ? <ChatWindow currentUserId={user?.id || ''} recipient={displayRecipient} messages={messages} onSendMessage={sendMessage} onUploadAttachment={uploadAttachment} onDownloadAttachment={downloadAttachment} onUploadVoice={uploadVoiceNote} onVoiceError={() => setError(t('messaging.voiceError'))} renderMessageFooter={message => {
          const suggestion = suggestions.get(message.id);
          if (!suggestion) return null;
          const other = activeConversation.participants.find(participant => participant.id !== user?.id);
          const sessionRoles = (user?.role === 'teacher' && other?.role === 'student') || (user?.role === 'student' && other?.role === 'teacher');
          return <ScheduleSuggestionCard suggestion={suggestion} canProposeSession={!!sessionRoles} sessionLabel={user?.role === 'teacher' ? t('chatSchedule.proposeSession') : t('chatSchedule.requestSession')} onCreateEvent={() => void openScheduling(message, suggestion, false)} onSession={() => void openScheduling(message, suggestion, true)} onDismiss={() => dismiss(message.id)} />;
        }} onRequestTutoring={user?.role === 'student' ? () => setShowBooking(true) : undefined} richMediaEnabled={false} /> : <div className="h-64 grid place-items-center bg-white border rounded-xl text-sm text-slate-500">{t('messaging.selectConversation')}</div>}
      </div>
    </div>
    {scheduleNotice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{scheduleNotice}</p>}
    {scheduling && <EventDialog role={user?.role || 'student'} draft={scheduling.draft} connections={scheduling.connections} defaultDurationMinutes={scheduling.duration} onClose={() => setScheduling(null)} onSaved={message => { setScheduling(null); setScheduleNotice(message); }} />}
    {showBooking && <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"><div className="w-full max-w-xl"><SessionBookingForm onBook={bookSession} onCancel={() => setShowBooking(false)} /></div></div>}
  </div>;
};
