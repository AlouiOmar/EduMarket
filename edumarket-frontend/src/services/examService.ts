import { Exam, ExamAttemptResult } from '../types';
import { apiRequest, ApiResponse, createSuccessResponse } from './apiClient';

class ExamService {
  async list(): Promise<ApiResponse<Exam[]>> {
    const result = await apiRequest<{ data: Exam[] }>('/exams');
    return createSuccessResponse(result.data);
  }
  async enroll(examId: string): Promise<void> {
    await apiRequest(`/exams/${encodeURIComponent(examId)}/enroll`, { method: 'POST', body: '{}' });
  }
  async listManage(): Promise<Exam[]> {
    const result = await apiRequest<{ data: Exam[] }>('/exams/manage');
    return result.data;
  }
  async listRegistrations(examId: string): Promise<ExamRegistration[]> {
    const result = await apiRequest<{ data: ExamRegistration[] }>(`/exams/${encodeURIComponent(examId)}/registrations`);
    return result.data;
  }
  async gradeRegistration(examId: string, studentId: string, score: number, feedback: string): Promise<void> {
    await apiRequest(`/exams/${encodeURIComponent(examId)}/registrations/${encodeURIComponent(studentId)}/result`, {
      method: 'PATCH', body: JSON.stringify({ score, feedback }),
    });
  }
  async get(examId: string): Promise<Exam> {
    const result = await apiRequest<{ data: Exam }>(`/exams/${encodeURIComponent(examId)}`);
    return result.data;
  }
  async start(examId: string): Promise<{ startedAt: string; deadline: string }> {
    const result = await apiRequest<{ data: { startedAt: string; deadline: string } }>(`/exams/${encodeURIComponent(examId)}/attempts/start`, { method: 'POST', body: '{}' });
    return result.data;
  }
  async submit(examId: string, answers: { questionId: string; selectedOptionIndex: number }[]): Promise<ExamAttemptResult> {
    const result = await apiRequest<{ data: ExamAttemptResult }>(`/exams/${encodeURIComponent(examId)}/attempts`, { method: 'POST', body: JSON.stringify({ answers }) });
    return result.data;
  }
}
export interface ExamRegistration { studentId: string; studentName: string; email: string; registeredAt: string; result: null | { score: number; passed: boolean; feedback: string; gradedAt: string }; }
export const examService = new ExamService();
