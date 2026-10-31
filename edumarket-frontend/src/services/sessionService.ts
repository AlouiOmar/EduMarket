import { TutoringSession } from '../types';
import { ApiResponse, apiRequest, createSuccessResponse, usesApi } from './apiClient';

type RawSession = Record<string, any>;
const normalize = (value: RawSession): TutoringSession => {
  const teacher = typeof value.teacherId === 'object' ? value.teacherId : { _id: value.teacherId, name: '' };
  const student = typeof value.studentId === 'object' ? value.studentId : { _id: value.studentId, name: '' };
  const start = new Date(value.startAt), end = new Date(value.endAt);
  return {
    id: value._id || value.id, teacherId: teacher._id || teacher.id, teacherName: teacher.name || '', teacherAvatar: '',
    studentId: student?._id || student?.id || '', studentName: student?.name || '', studentAvatar: '',
    subject: value.subject || '', notes: value.notes || '', type: value.type, status: value.status, paymentStatus: value.paymentStatus,
    startAt: start.toISOString(), endAt: end.toISOString(),
    date: start.toISOString().slice(0, 10), startTime: start.toISOString().slice(11, 16), endTime: end.toISOString().slice(11, 16),
    durationMinutes: Math.round((end.getTime() - start.getTime()) / 60000), price: value.price,
    rating: value.review?.rating, reviewComment: value.review?.comment,
    jitsiRoomId: value.jitsiRoomId || undefined, meetingUrl: value.meetingUrl || undefined, location: value.venue ? { venue: value.venue, address: '', city: '' } : undefined,
  };
};

class SessionService {
  async getSessions(_userId?: string): Promise<ApiResponse<TutoringSession[]>> {
    if (!usesApi) return createSuccessResponse([]);
    const result = await apiRequest<{ data: RawSession[] }>('/sessions');
    return createSuccessResponse(result.data.map(normalize));
  }
  async getAvailability(teacherId?: string): Promise<ApiResponse<(TutoringSession & { slotId: string })[]>> {
    if (!usesApi) return createSuccessResponse([]);
    const result = await apiRequest<{ data: RawSession[] }>(`/sessions/availability${teacherId ? `?teacherId=${encodeURIComponent(teacherId)}` : ''}`);
    return createSuccessResponse(result.data.map(raw => ({ ...normalize(raw), slotId: raw._id })));
  }
  async bookSession(data: { slotId: string; subject: string; notes?: string }): Promise<ApiResponse<TutoringSession>> {
    if (!usesApi) throw new Error('Tutoring sessions require API mode. Set VITE_DATA_MODE=api.');
    const result = await apiRequest<{ data: RawSession }>(`/sessions/${encodeURIComponent(data.slotId)}/book`, { method: 'POST', body: JSON.stringify({ subject: data.subject, notes: data.notes }) });
    return createSuccessResponse(normalize(result.data));
  }
  async createAvailability(data: { startAt: string; endAt: string; type: 'online' | 'in_person'; price: number; venue?: string; subject?: string; notes?: string }): Promise<ApiResponse<TutoringSession>> {
    const result = await apiRequest<{ data: RawSession }>('/sessions/availability', { method: 'POST', body: JSON.stringify(data) });
    return createSuccessResponse(normalize(result.data));
  }
  async updateSessionStatus(id: string, status: TutoringSession['status']): Promise<ApiResponse<TutoringSession>> {
    const result = await apiRequest<{ data: RawSession }>(`/sessions/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    return createSuccessResponse(normalize(result.data));
  }
  /** Moves a booked session to another open slot of the same teacher (same type and price). */
  async reschedule(id: string, targetSessionId: string): Promise<TutoringSession> {
    const result = await apiRequest<{ data: RawSession }>(`/sessions/${encodeURIComponent(id)}/reschedule`, { method: 'POST', body: JSON.stringify({ targetSessionId }) });
    return normalize(result.data);
  }
  async reviewSession(id: string, rating: number, comment: string): Promise<{ rating: number; comment: string }> {
    const result = await apiRequest<{ data: { rating: number; comment: string } }>(`/sessions/${encodeURIComponent(id)}/review`, {
      method: 'PUT', body: JSON.stringify({ rating, comment }),
    });
    return result.data;
  }
}
export const sessionService = new SessionService();
