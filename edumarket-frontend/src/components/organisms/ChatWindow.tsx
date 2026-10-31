import React, { useEffect, useState } from 'react';
import { ReportButton } from './ReportButton';
import { useTranslation } from 'react-i18next';
import { 
  Send, 
  Mic, 
  Square, 
  Paperclip, 
  Play, 
  Pause, 
  Calendar, 
  FileText,
  CheckCheck
} from 'lucide-react';
import { Message, User } from '../../types';
import { Avatar } from '../atoms/Avatar';
import { Button } from '../atoms/Button';

export interface ChatWindowProps {
  currentUserId: string;
  recipient: User;
  messages: Message[];
  onSendMessage: (text: string, voiceUrl?: string, attachment?: { name: string; size: string; url: string }) => void;
  onUploadAttachment?: (file: File) => Promise<void>;
  onDownloadAttachment?: (attachment: { name: string; size: string; url: string }) => Promise<void>;
  onUploadVoice?: (voice: Blob, durationSeconds: number) => Promise<void>;
  onVoiceError?: () => void;
  onRequestTutoring?: () => void;
  richMediaEnabled?: boolean;
  /** Extra content under a message (e.g. a scheduling suggestion); computed by the page, not by the chat. */
  renderMessageFooter?: (message: Message) => React.ReactNode;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  currentUserId,
  recipient,
  messages,
  onSendMessage,
  onUploadAttachment,
  onDownloadAttachment,
  onUploadVoice,
  onVoiceError,
  onRequestTutoring,
  richMediaEnabled = true,
  renderMessageFooter,
}) => {
  const { t } = useTranslation();
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const voiceChunksRef = React.useRef<Blob[]>([]);
  const recordingStartedAtRef = React.useRef(0);

  const stopVoiceRecording = () => {
    if (onUploadVoice) {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      return;
    }
    setIsRecording(false);
    onSendMessage(`[Note Vocale - 0:${String(recordingSeconds).padStart(2, '0')}]`, 'mock-voice-recording.mp3');
    setRecordingSeconds(0);
  };

  const startVoiceRecording = async () => {
    if (!onUploadVoice) {
      recordingStartedAtRef.current = Date.now();
      setIsRecording(true);
      setRecordingSeconds(0);
      return;
    }
    let acquiredStream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('VOICE_RECORDING_UNAVAILABLE');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      acquiredStream = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      voiceChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      recorder.ondataavailable = event => { if (event.data.size) voiceChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const duration = Math.max(1, Math.min(60, Math.round((Date.now() - recordingStartedAtRef.current) / 1000)));
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || voiceChunksRef.current[0]?.type || 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        voiceChunksRef.current = [];
        setIsRecording(false);
        setRecordingSeconds(0);
        if (blob.size) {
          setVoiceBusy(true);
          void onUploadVoice(blob, duration).catch(() => onVoiceError?.()).finally(() => setVoiceBusy(false));
        }
      };
      recorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);
    } catch { acquiredStream?.getTracks().forEach(track => track.stop()); onVoiceError?.(); }
  };

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      const seconds = Math.min(60, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
      setRecordingSeconds(seconds);
      if (seconds >= 60) stopVoiceRecording();
    }, 250);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => () => {
    if (recorderRef.current) {
      recorderRef.current.onstop = null;
      if (recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  const handleSend = () => {
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAttachMockFile = () => {
    onSendMessage(t('demoUi.attachmentText'), undefined, {
      name: 'Synthese_Projet_Dev.pdf',
      size: '1.8 MB',
      url: '#'
    });
  };

  return (
    <div className="flex flex-col h-[600px] bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      {/* Top Bar */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
        <div className="flex items-center gap-3">
          <Avatar src={recipient.avatar} alt={recipient.name} size="sm" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">{recipient.name}</h3>
            <span className="text-[11px] text-emerald-600 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {richMediaEnabled ? t('messaging.online') : t('messaging.textChat')}
            </span>
          </div>
        </div>

        {onRequestTutoring && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRequestTutoring}
            leftIcon={<Calendar className="w-3.5 h-3.5" />}
          >
            {t('messaging.proposeSession')}
          </Button>
        )}
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
        {messages.map((msg) => {
          const isMine = msg.senderId === currentUserId;
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-xs shadow-xs ${
                  isMine
                    ? 'bg-indigo-600 text-white rounded-br-xs'
                    : 'bg-white border border-slate-200 text-slate-800 rounded-bl-xs'
                }`}
              >
                {msg.hidden && <p className="italic opacity-70">{t('reports.messageHidden')}</p>}
                {msg.text && <p className="leading-relaxed">{msg.text}</p>}

                {/* Voice Note Player */}
                {msg.voiceUrl && (
                  msg.voiceUrl.startsWith('/messaging/voice-notes/') ? <audio controls preload="none" crossOrigin="use-credentials" src={msg.voiceUrl} className="mt-2 max-w-full" aria-label={t('messaging.playVoice')} /> :
                  <div className="flex items-center gap-2.5 mt-1.5 pt-1.5 border-t border-white/20">
                    <button
                      type="button"
                      onClick={() => setPlayingVoiceId(playingVoiceId === msg.id ? null : msg.id)}
                      className={`p-1.5 rounded-full ${isMine ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-700'}`}
                    >
                      {playingVoiceId === msg.id ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <div className="flex-1 h-1.5 bg-slate-200/50 rounded-full overflow-hidden w-28">
                      <div className={`h-full ${isMine ? 'bg-white' : 'bg-indigo-600'} ${playingVoiceId === msg.id ? 'w-2/3 animate-pulse' : 'w-1/4'}`} />
                    </div>
                    <span className="text-[10px] tabular-nums font-mono">0:24</span>
                  </div>
                )}

                {/* Attachment Display */}
                {msg.attachment && (
                  <button type="button" disabled={!onDownloadAttachment} onClick={() => { if (onDownloadAttachment && msg.attachment) void onDownloadAttachment(msg.attachment); }} className={`w-full text-start flex items-center gap-2 mt-2 p-2 rounded-lg ${isMine ? 'bg-indigo-700/60' : 'bg-slate-100'} ${onDownloadAttachment ? 'hover:opacity-80' : ''}`}>
                    <FileText className="w-4 h-4 shrink-0" />
                    <div className="truncate">
                      <span className="font-semibold block truncate">{msg.attachment.name}</span>
                      <span className="text-[10px] opacity-80">{msg.attachment.size}</span>
                    </div>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1 px-1">
                <span className="tabular-nums">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {isMine && <CheckCheck className="w-3 h-3 text-indigo-500" />}
                {!isMine && !msg.hidden && <ReportButton targetType="message" targetId={msg.id} compact className="ms-1" />}
              </div>
              {!msg.hidden && renderMessageFooter?.(msg)}
            </div>
          );
        })}
      </div>

      {/* Input Tray */}
      <div className="p-3 border-t border-slate-200 bg-white flex items-center gap-2">
        {onUploadAttachment ? <label className={`p-2 text-slate-500 rounded-lg ${attachmentBusy ? 'opacity-50' : 'hover:bg-slate-100 cursor-pointer'}`} aria-label={t('messaging.attachFile')} title={attachmentBusy ? t('messaging.uploadingAttachment') : t('messaging.attachFile')}>
          <Paperclip className="w-4 h-4" />
          <input className="sr-only" type="file" accept="application/pdf,application/zip,application/x-zip-compressed,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.zip,.docx" disabled={attachmentBusy} onChange={event => {
            const file = event.target.files?.[0];
            if (file) { setAttachmentBusy(true); void onUploadAttachment(file).finally(() => setAttachmentBusy(false)); }
            event.target.value = '';
          }} />
        </label> : richMediaEnabled && <button
          type="button"
          onClick={handleAttachMockFile}
          aria-label={t('messaging.attachFile')}
          className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <Paperclip className="w-4 h-4" />
        </button>}

        {isRecording && (richMediaEnabled || onUploadVoice) ? (
          <div className="flex-1 flex items-center justify-between px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-xs font-medium">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping" />
              <span>{t('messaging.recording')} ({Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')})</span>
            </div>
            <button
              onClick={stopVoiceRecording}
              className="text-xs font-bold text-rose-800 hover:underline"
            >
              {t('chromeUi.finishAndSend')}
            </button>
          </div>
        ) : (
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('messaging.typeMessage')}
            className="flex-1 bg-slate-100 rounded-lg px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        )}

        {inputText.trim() ? (
          <Button variant="primary" size="sm" onClick={handleSend} aria-label={t('messaging.send')}>
            <Send className="w-4 h-4 rtl-flip" />
          </Button>
        ) : onUploadVoice || richMediaEnabled ? (
          <button
            type="button"
            onClick={() => { if (isRecording) stopVoiceRecording(); else void startVoiceRecording(); }}
            disabled={voiceBusy}
            aria-label={t('messaging.recordVoice')}
            title={voiceBusy ? t('messaging.uploadingVoice') : t('messaging.recordVoice')}
            className={`p-2 rounded-lg transition-colors ${isRecording ? 'bg-rose-600 text-white' : 'text-slate-500 hover:bg-slate-100'} ${voiceBusy ? 'opacity-50' : ''}`}
          >
            {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
        ) : null}
      </div>
    </div>
  );
};
