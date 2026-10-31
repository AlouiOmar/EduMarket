import { Assignment } from '../types';
import { ApiResponse, apiRequest, createSuccessResponse, downloadApiFile } from './apiClient';

class AssignmentService {
  async listStudent(): Promise<ApiResponse<Assignment[]>> {
    const result = await apiRequest<{ data: Assignment[] }>('/assignments');
    return createSuccessResponse(result.data);
  }
  async submit(assignmentId: string, answerText: string, files: File[] = []): Promise<void> {
    if (files.length) {
      const body = new FormData();
      body.append('answerText', answerText);
      files.forEach(file => body.append('files', file));
      await apiRequest(`/assignments/${encodeURIComponent(assignmentId)}/submissions`, { method: 'POST', body });
      return;
    }
    await apiRequest(`/assignments/${encodeURIComponent(assignmentId)}/submissions`, { method: 'POST', body: JSON.stringify({ answerText }) });
  }
  downloadFile(file: { name: string; url: string }): Promise<void> { return downloadApiFile(file.url, file.name); }
  async listTeacher(): Promise<ApiResponse<Assignment[]>> {
    const result = await apiRequest<{ data: Assignment[] }>('/assignments/teacher');
    return createSuccessResponse(result.data);
  }
  async create(data: { courseId: string; title: string; instructions: string; dueAt: string; points: number }): Promise<void> {
    await apiRequest('/assignments', { method: 'POST', body: JSON.stringify(data) });
  }
  async grade(assignmentId: string, submissionId: string, score: number, feedback: string): Promise<void> {
    await apiRequest(`/assignments/${encodeURIComponent(assignmentId)}/submissions/${encodeURIComponent(submissionId)}/grade`, { method: 'PATCH', body: JSON.stringify({ score, feedback }) });
  }
}
export const assignmentService = new AssignmentService();
