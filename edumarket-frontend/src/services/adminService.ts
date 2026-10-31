import { 
  mockUsers, 
  mockVerificationRequests, 
  mockInstitutions, 
  mockAuditLogs 
} from '../mocks/mockData';
import { User, TeacherVerificationRequest, Institution, AuditLog } from '../types';
import { apiRequest, delay, createSuccessResponse, ApiResponse, usesApi } from './apiClient';
import { teacherVerificationService } from './teacherVerificationService';

export interface PlatformSettingsDto { commissionRate: number; maintenanceMode: boolean; subscription: { enabled: boolean; monthlyPrice: number; yearlyPrice: number }; offlinePayments?: { enabled: boolean; instructions: string } }

class AdminService {
  private users: User[] = Object.values(mockUsers);
  private verificationRequests: TeacherVerificationRequest[] = [...mockVerificationRequests];
  private institutions: Institution[] = [...mockInstitutions];
  private auditLogs: AuditLog[] = [...mockAuditLogs];

  async getPlatformSettings(): Promise<PlatformSettingsDto> {
    const result = await apiRequest<{ data: PlatformSettingsDto }>('/admin/settings');
    return result.data;
  }

  async updatePlatformSettings(changes: Partial<PlatformSettingsDto>): Promise<PlatformSettingsDto> {
    const result = await apiRequest<{ data: PlatformSettingsDto }>('/admin/settings', {
      method: 'PATCH', body: JSON.stringify(changes),
    });
    return result.data;
  }

  private mapApiUser(user: Pick<User, 'id' | 'name' | 'email' | 'role' | 'verified' | 'status'> & { createdAt?: string }): User {
    return { ...user, avatar: '', joinedDate: user.createdAt?.slice(0, 10) || '' };
  }

  async getUsers(): Promise<ApiResponse<User[]>> {
    if (usesApi) {
      const result = await apiRequest<{ data: Array<User & { createdAt?: string }>; total: number }>('/admin/users');
      return createSuccessResponse(result.data.map(user => this.mapApiUser(user)), undefined, result.total);
    }
    await delay();
    return createSuccessResponse(this.users);
  }

  async updateUserRole(userId: string, newRole: User['role']): Promise<ApiResponse<User | null>> {
    if (usesApi) {
      const result = await apiRequest<{ data: User & { createdAt?: string } }>(`/admin/users/${encodeURIComponent(userId)}/role`, {
        method: 'PATCH', body: JSON.stringify({ role: newRole }),
      });
      return createSuccessResponse(this.mapApiUser(result.data));
    }
    await delay();
    const u = this.users.find(user => user.id === userId);
    if (!u) return createSuccessResponse(null, 'Utilisateur introuvable');
    u.role = newRole;
    return createSuccessResponse(u, 'Rôle mis à jour');
  }

  async updateUserStatus(userId: string, newStatus: User['status']): Promise<ApiResponse<User | null>> {
    if (usesApi) {
      if (newStatus === 'pending') throw new Error('INVALID_USER_STATUS');
      const result = await apiRequest<{ data: User & { createdAt?: string } }>(`/admin/users/${encodeURIComponent(userId)}/status`, {
        method: 'PATCH', body: JSON.stringify({ status: newStatus }),
      });
      return createSuccessResponse(this.mapApiUser(result.data));
    }
    await delay();
    const u = this.users.find(user => user.id === userId);
    if (!u) return createSuccessResponse(null, 'Utilisateur introuvable');
    u.status = newStatus;
    return createSuccessResponse(u, `Statut mis à jour : ${newStatus}`);
  }

  async getVerificationRequests(): Promise<ApiResponse<TeacherVerificationRequest[]>> {
    if (usesApi) return createSuccessResponse(await teacherVerificationService.getQueue());
    await delay();
    return createSuccessResponse(this.verificationRequests);
  }

  async reviewTeacherRequest(requestId: string, status: 'approved' | 'rejected'): Promise<ApiResponse<boolean>> {
    if (usesApi) {
      await teacherVerificationService.review(requestId, status);
      return createSuccessResponse(true);
    }
    await delay();
    const req = this.verificationRequests.find(r => r.id === requestId);
    if (!req) return createSuccessResponse(false, 'Demande introuvable');
    req.status = status;
    if (status === 'approved') {
      const teacher = this.users.find(u => u.id === req.teacherId);
      if (teacher) {
        teacher.role = 'teacher';
        teacher.status = 'active';
      }
    }
    return createSuccessResponse(true, `Demande de formateur ${status === 'approved' ? 'approuvée' : 'rejetée'}`);
  }

  async getInstitutions(): Promise<ApiResponse<Institution[]>> {
    await delay();
    return createSuccessResponse(this.institutions);
  }

  async getAuditLogs(): Promise<ApiResponse<AuditLog[]>> {
    if (usesApi) {
      const result = await apiRequest<{ data: AuditLog[] }>('/admin/users/audit');
      return createSuccessResponse(result.data);
    }
    await delay();
    return createSuccessResponse(this.auditLogs);
  }
}

export const adminService = new AdminService();
