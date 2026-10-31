import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { mockConversations, mockUsers } from '../../mocks/mockData';
import { Conversation, Message, User } from '../../types';
import { ChatWindow } from '../../components/organisms/ChatWindow';
import { SearchField } from '../../components/molecules/SearchField';
import { Avatar } from '../../components/atoms/Avatar';
import { SessionBookingForm } from '../../components/organisms/SessionOrganisms';
import { sessionService } from '../../services/sessionService';
import { usesApi } from '../../services/apiClient';
import { ApiMessagingPage } from './ApiMessagingPage';

const MockMessagingPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentUserId = mockUsers.student.id;

  const [conversations, setConversations] = useState<Conversation[]>(mockConversations);
  const [activeConvId, setActiveConvId] = useState<string>(conversations[0]?.id || 'conv_1');
  const [search, setSearch] = useState('');
  const [showBookingModal, setShowBookingModal] = useState(false);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'm_1',
      conversationId: 'conv_1',
      senderId: 'user_teacher_1',
      text: 'Bonjour Karim ! Avez-vous pu tester l’implémentation de useActionState sur le panier ?',
      timestamp: '2026-10-13T10:15:00Z',
      read: true
    },
    {
      id: 'm_2',
      conversationId: 'conv_1',
      senderId: 'user_student_1',
      text: 'Bonjour Dr. Sarah Mansour ! Oui, cela simplifie énormément la gestion des formulaires asynchrones. J’ai une question sur l’optimisation du re-render.',
      timestamp: '2026-10-13T10:20:00Z',
      read: true
    },
    {
      id: 'm_3',
      conversationId: 'conv_1',
      senderId: 'user_teacher_1',
      text: 'Parfait ! N’hésitez pas à réserver un créneau de mentorat de 30 min si vous souhaitez une revue de code détaillée.',
      timestamp: '2026-10-13T10:25:00Z',
      read: true
    }
  ]);

  const activeConv = conversations.find(c => c.id === activeConvId);
  const recipient = mockUsers.teacher;

  const handleSendMessage = (text: string, voiceUrl?: string, attachment?: any) => {
    const newMsg: Message = {
      id: `msg_${Date.now()}`,
      conversationId: activeConvId,
      senderId: currentUserId,
      text,
      voiceUrl,
      attachment,
      timestamp: new Date().toISOString(),
      read: false
    };
    setMessages(prev => [...prev, newMsg]);
  };

  const handleBookFromChat = async (bookingData: { slotId: string; subject: string; notes?: string }) => {
    await sessionService.bookSession(bookingData);
    setShowBookingModal(false);
    navigate('/sessions');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('messaging.inbox')}</h1>
        <p className="text-xs text-slate-500 mt-1">{t('sharedUi.messagingSubtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Conversations List */}
        <div className="md:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="p-3 border-b border-slate-200">
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder={t('sharedUi.searchConversation')}
            />
          </div>

          <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
            {conversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => setActiveConvId(conv.id)}
                className={`w-full p-4 flex items-start gap-3 text-start transition-colors ${
                  conv.id === activeConvId ? 'bg-indigo-50/80' : 'hover:bg-slate-50'
                }`}
              >
                <Avatar src={recipient.avatar} alt={recipient.name} size="md" />
                <div className="flex-1 truncate">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 truncate">{recipient.name}</span>
                    <span className="text-[10px] text-slate-400">10:25</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {conv.lastMessage.text}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Chat Thread */}
        <div className="md:col-span-8">
          <ChatWindow
            currentUserId={currentUserId}
            recipient={recipient}
            messages={messages}
            onSendMessage={handleSendMessage}
            onRequestTutoring={() => setShowBookingModal(true)}
          />
        </div>
      </div>

      {/* Booking Modal */}
      {showBookingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-xl">
            <SessionBookingForm
              onBook={handleBookFromChat}
              onCancel={() => setShowBookingModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export const MessagingPage: React.FC = () => usesApi ? <ApiMessagingPage /> : <MockMessagingPage />;
