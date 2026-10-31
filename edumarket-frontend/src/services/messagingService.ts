import { Conversation, Message, User } from '../types';
import { API_BASE_URL, apiRequest, createSuccessResponse, ApiResponse, downloadApiFile } from './apiClient';

type UserDto = { _id?: string; id?: string; name: string; role: User['role']; headline?: string };
type ConversationDto = { id: string; participants: UserDto[]; lastMessage: { text: string; timestamp: string } | null; unreadCount: number; updatedAt: string };
const normalizeUser = (user: UserDto): User => ({ id: String(user._id || user.id), name: user.name, email: '', avatar: '', role: user.role, status: 'active', joinedDate: '', headline: user.headline || '' });
const normalizeConversation = (row: ConversationDto): Conversation => ({
  id: row.id, participants: row.participants.map(normalizeUser),
  lastMessage: row.lastMessage ? { id: '', conversationId: row.id, senderId: '', text: row.lastMessage.text, timestamp: row.lastMessage.timestamp, read: false } : { id: '', conversationId: row.id, senderId: '', text: '', timestamp: row.updatedAt, read: true },
  unreadCount: row.unreadCount, updatedAt: row.updatedAt,
});

class MessagingService {
  connectToMessageEvents(onMessage: (event: { conversationId: string }) => void): EventSource {
    const source = new EventSource(`${API_BASE_URL}/messaging/events`, { withCredentials: true });
    source.addEventListener('message.created', event => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { conversationId?: unknown };
        if (typeof payload.conversationId === 'string') onMessage({ conversationId: payload.conversationId });
      } catch { /* Ignore malformed event payloads and leave the connection usable. */ }
    });
    return source;
  }
  async listConversations(): Promise<ApiResponse<Conversation[]>> {
    const response = await apiRequest<{ data: ConversationDto[] }>('/messaging/conversations');
    return createSuccessResponse(response.data.map(normalizeConversation));
  }
  async createConversation(email: string): Promise<Conversation> {
    const response = await apiRequest<{ data: ConversationDto }>('/messaging/conversations', { method: 'POST', body: JSON.stringify({ email }) });
    return normalizeConversation(response.data);
  }
  async listMessages(conversationId: string): Promise<ApiResponse<Message[]>> {
    const response = await apiRequest<{ data: Message[] }>(`/messaging/conversations/${encodeURIComponent(conversationId)}/messages`);
    return createSuccessResponse(response.data);
  }
  async sendText(conversationId: string, text: string): Promise<Message> {
    const response = await apiRequest<{ data: Message }>(`/messaging/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
    return response.data;
  }
  async sendAttachment(conversationId: string, file: File): Promise<Message> {
    const body = new FormData(); body.append('file', file);
    const response = await apiRequest<{ data: Message }>(`/messaging/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body });
    return response.data;
  }
  async sendVoiceNote(conversationId: string, voice: Blob, durationSeconds: number): Promise<Message> {
    const body = new FormData();
    const extension = voice.type.startsWith('audio/ogg') ? 'ogg' : voice.type.startsWith('audio/mp4') ? 'm4a' : 'webm';
    body.append('durationSeconds', String(durationSeconds));
    body.append('voice', voice, `voice-note.${extension}`);
    const response = await apiRequest<{ data: Message }>(`/messaging/conversations/${encodeURIComponent(conversationId)}/voice-notes`, { method: 'POST', body });
    return response.data;
  }
  async downloadAttachment(attachment: { name: string; url: string }): Promise<void> {
    if (!attachment.url.startsWith('/messaging/attachments/')) throw new Error('INVALID_MESSAGE_ATTACHMENT_URL');
    await downloadApiFile(attachment.url, attachment.name);
  }
  async markRead(conversationId: string): Promise<void> {
    await apiRequest(`/messaging/conversations/${encodeURIComponent(conversationId)}/read`, { method: 'PATCH' });
  }
}
export const messagingService = new MessagingService();
