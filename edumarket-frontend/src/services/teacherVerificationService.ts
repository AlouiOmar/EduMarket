import { TeacherVerificationRequest } from '../types';
import { apiRequest, downloadApiFile } from './apiClient';

export const teacherVerificationService = {
  async getMine(): Promise<TeacherVerificationRequest | null> {
    const result = await apiRequest<{ data: TeacherVerificationRequest | null }>('/teacher-verifications/mine');
    return result.data;
  },

  async submit(input: { specialty: string; registrationNumber: string; credentialsSummary: string }): Promise<TeacherVerificationRequest> {
    const result = await apiRequest<{ data: TeacherVerificationRequest }>('/teacher-verifications', {
      method: 'POST', body: JSON.stringify(input),
    });
    return result.data;
  },

  async uploadDocument(file: File): Promise<TeacherVerificationRequest['documents'][number]> {
    const body = new FormData();
    body.append('file', file);
    const result = await apiRequest<{ data: TeacherVerificationRequest['documents'][number] }>('/teacher-verifications/documents', { method: 'POST', body });
    return result.data;
  },

  downloadDocument(document: TeacherVerificationRequest['documents'][number]): Promise<void> {
    return downloadApiFile(document.url, document.name);
  },

  async getQueue(): Promise<TeacherVerificationRequest[]> {
    const result = await apiRequest<{ data: TeacherVerificationRequest[] }>('/teacher-verifications/admin');
    return result.data;
  },

  async review(userId: string, status: 'approved' | 'rejected', reviewNote = ''): Promise<TeacherVerificationRequest> {
    const result = await apiRequest<{ data: TeacherVerificationRequest }>(`/teacher-verifications/admin/${encodeURIComponent(userId)}`, {
      method: 'PATCH', body: JSON.stringify({ status, reviewNote }),
    });
    return result.data;
  },
};
