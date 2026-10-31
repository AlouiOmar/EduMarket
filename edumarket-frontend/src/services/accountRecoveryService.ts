import { apiRequest, usesApi } from './apiClient';

interface RecoveryResult { accepted: boolean; previewUrl?: string; }

export const accountRecoveryService = {
  async requestPasswordReset(email: string): Promise<RecoveryResult> {
    if (!usesApi) return { accepted: true };
    return (await apiRequest<{ data: RecoveryResult }>('/auth/password/forgot', {
      method: 'POST', body: JSON.stringify({ email }),
    })).data;
  },
  async resetPassword(token: string, newPassword: string): Promise<void> {
    await apiRequest('/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, newPassword }) });
  },
  async resendVerification(email: string): Promise<RecoveryResult> {
    return (await apiRequest<{ data: RecoveryResult }>('/auth/email/verification/resend', {
      method: 'POST', body: JSON.stringify({ email }),
    })).data;
  },
  async verifyEmail(token: string): Promise<void> {
    await apiRequest('/auth/email/verification/confirm', { method: 'POST', body: JSON.stringify({ token }) });
  },
};
