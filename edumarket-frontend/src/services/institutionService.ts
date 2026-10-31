import { apiRequest } from './apiClient';
import { Course, Institution } from '../types';

export type InstitutionInternalRole = 'teacher' | 'coordinator' | 'examiner';
export interface AffiliatedTeacher { id: string; name: string; email: string; headline: string; revenueSharePercent?: number; internalRole?: InstitutionInternalRole; }
export interface MyAffiliation { institution: { id: string; name: string; email: string }; revenueSharePercent: number; internalRole: InstitutionInternalRole }
export interface InstitutionInvite { id: string; status: 'pending' | 'accepted' | 'rejected' | 'ended'; revenueSharePercent?: number; createdAt: string; teacher?: AffiliatedTeacher; institution?: { name: string; email: string }; }
export interface InstitutionApplication { id: string; name: string; description: string; country: string; city: string; website: string; contactEmail: string; status: 'pending' | 'approved' | 'rejected'; reviewNote?: string; ownerId: { name: string; email: string } | string; createdAt: string; }

class InstitutionService {
  async publicDirectory(): Promise<Institution[]> {
    return (await apiRequest<{ data: Institution[] }>('/institutions')).data;
  }
  async publicDetail(institutionId: string): Promise<{ institution: Institution; courses: Course[] }> {
    return (await apiRequest<{ data: { institution: Institution; courses: Course[] } }>(`/institutions/${encodeURIComponent(institutionId)}`)).data;
  }
  async application(): Promise<InstitutionApplication | null> {
    return (await apiRequest<{ data: InstitutionApplication | null }>('/institution-verifications/mine')).data;
  }
  async submitApplication(input: Pick<InstitutionApplication, 'name' | 'description' | 'country' | 'city' | 'website' | 'contactEmail'>): Promise<void> {
    await apiRequest('/institution-verifications', { method: 'POST', body: JSON.stringify(input) });
  }
  async adminApplications(): Promise<InstitutionApplication[]> {
    return (await apiRequest<{ data: InstitutionApplication[] }>('/institution-verifications/admin')).data;
  }
  async reviewApplication(id: string, status: 'approved' | 'rejected', reviewNote = ''): Promise<void> {
    await apiRequest(`/institution-verifications/admin/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status, reviewNote }) });
  }
  async teachers(): Promise<AffiliatedTeacher[]> {
    return (await apiRequest<{ data: AffiliatedTeacher[] }>('/institutions/teachers')).data;
  }
  async sentInvitations(): Promise<InstitutionInvite[]> {
    return (await apiRequest<{ data: InstitutionInvite[] }>('/institutions/invitations')).data;
  }
  async inviteTeacher(email: string, revenueSharePercent = 0): Promise<void> {
    await apiRequest('/institutions/invitations', { method: 'POST', body: JSON.stringify({ email, revenueSharePercent }) });
  }
  async updateMember(teacherId: string, input: { internalRole?: InstitutionInternalRole; revenueSharePercent?: number }): Promise<AffiliatedTeacher> {
    return (await apiRequest<{ data: AffiliatedTeacher }>(`/institutions/teachers/${encodeURIComponent(teacherId)}`, { method: 'PATCH', body: JSON.stringify(input) })).data;
  }
  async myAffiliation(): Promise<MyAffiliation | null> {
    return (await apiRequest<{ data: MyAffiliation | null }>('/institutions/affiliation/mine')).data;
  }
  async endAffiliation(teacherId: string): Promise<void> {
    await apiRequest(`/institutions/teachers/${encodeURIComponent(teacherId)}`, { method: 'DELETE' });
  }
  async leaveAffiliation(): Promise<void> {
    await apiRequest('/institutions/affiliation/mine', { method: 'DELETE' });
  }
  async myInvitations(): Promise<InstitutionInvite[]> {
    return (await apiRequest<{ data: InstitutionInvite[] }>('/institutions/invitations/mine')).data;
  }
  async affiliatedInstitution(): Promise<{ name: string; email: string; revenueSharePercent: number } | null> {
    const user = (await apiRequest<{ data: { institutionId?: string } }>('/auth/me')).data;
    if (!user.institutionId) return null;
    const all = await this.myInvitations();
    const accepted = all.find(invite => invite.status === 'accepted');
    return accepted?.institution ? { ...accepted.institution, revenueSharePercent: accepted.revenueSharePercent || 0 } : null;
  }
  async respond(invitationId: string, decision: 'accepted' | 'rejected'): Promise<void> {
    await apiRequest(`/institutions/invitations/${encodeURIComponent(invitationId)}`, { method: 'PATCH', body: JSON.stringify({ decision }) });
  }
}
export const institutionService = new InstitutionService();
