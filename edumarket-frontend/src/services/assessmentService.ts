import { apiRequest } from './apiClient';

/** Assessments API: question banks, tests, attempts, rubrics, forms and course assignments. */
export type QuestionType = 'single' | 'multiple' | 'true_false' | 'short' | 'essay';
export type Difficulty = 'easy' | 'medium' | 'hard';
export interface Bank { id: string; title: string; description: string; questionCount: number }
export interface Question { id: string; bankId: string; type: QuestionType; prompt: string; options: { id: string; text: string }[]; correct: string[]; caseSensitive: boolean; points: number; chapter: string; difficulty: Difficulty; explanation: string }
export type QuestionInput = Omit<Question, 'id' | 'bankId'>;
export type Section = { kind: 'fixed'; questionIds: string[] } | { kind: 'random'; bankId: string; count: number; chapter?: string; difficulty?: '' | Difficulty };
export interface TestDefinition {
  id: string; title: string; instructions: string; status: 'draft' | 'published' | 'closed'; availableFrom: string | null; availableUntil: string | null;
  timeLimitMinutes: number; maxAttempts: number; shuffleQuestions: boolean; shuffleOptions: boolean; sections: Section[]; gradePolicy: 'best' | 'last'; showCorrectAnswers: boolean;
  attempts?: number; toGrade?: number;
}
export type TestInput = Omit<TestDefinition, 'id' | 'status' | 'attempts' | 'toGrade'>;
export interface AttemptQuestion { questionId: string; type: QuestionType; prompt: string; points: number; options: { id: string; text: string }[]; correct?: string[]; explanation?: string }
export interface AttemptAnswer { questionId: string; optionIds: string[]; text: string; savedAt?: string }
export interface TeacherAttempt {
  id: string; studentId: string; studentName: string; number: number; status: 'in_progress' | 'needs_grading' | 'graded'; startedAt: string; submittedAt: string | null; autoSubmitted: boolean;
  score: number | null; maxScore: number; questions: (AttemptQuestion & { correct: string[] })[]; answers: AttemptAnswer[]; autoScores: { questionId: string; score: number }[]; manual: { questionId: string; score: number; feedback: string }[];
}
export interface StudentTest {
  id: string; title: string; instructions: string; availableFrom: string | null; availableUntil: string | null; timeLimitMinutes: number; maxAttempts: number; attemptsUsed: number;
  open: boolean; inProgress: string | null; attempts: { id: string; number: number; status: string; submittedAt: string | null }[]; publishedGrade: { score: number | null } | null;
}
export interface StudentAttempt {
  id: string; testId: string; number: number; status: 'in_progress' | 'needs_grading' | 'graded'; startedAt: string; deadlineAt: string | null; submittedAt: string | null; autoSubmitted: boolean;
  questions: AttemptQuestion[]; answers: AttemptAnswer[]; gradePublished?: boolean; score?: number | null; maxScore?: number; feedback?: { questionId: string; score: number; feedback: string }[];
}
export interface Rubric { id: string; title: string; visibleToStudents: boolean; maxPoints: number; criteria: { id: string; title: string; description: string; levels: { id: string; title: string; points: number; description: string }[] }[] }
export type RubricInput = Omit<Rubric, 'id' | 'maxPoints'>;
export interface FormQuestion { id: string; type: 'single' | 'multiple' | 'text' | 'scale'; prompt: string; options: string[]; required: boolean }
export interface CourseForm { id: string; title: string; description: string; anonymous: boolean; status: 'draft' | 'published' | 'closed'; availableFrom: string | null; availableUntil: string | null; questions: FormQuestion[]; responses?: number; answered?: boolean; open?: boolean }
export interface FormResults { form: CourseForm; total: number; tallies: { questionId: string; counts?: Record<string, number> }[]; responses: { id: string; submittedAt: string; respondent: string | null; answers: { questionId: string; values: string[] }[] }[] }
export interface AssignmentFile { name: string; type: string; url: string }
export interface CourseAssignment {
  id: string; title: string; instructions: string; dueAt: string; points: number; status: string; lateUntil: string | null; latePenaltyPercent: number; maxAttempts: number;
  rubricId: string | null; allowLinks: boolean; attachments: { assetId: string; name: string; url: string }[];
  submissions: { id: string; studentId: string; studentName: string; answerText: string; links: string[]; files: AssignmentFile[]; status: 'submitted' | 'graded'; submittedAt: string; late: boolean; attemptCount: number; score: number | null; rawScore: number | null; penaltyPercent: number; feedback: string; rubricRatings: { criterionId: string; levelId: string }[]; history: { answerText: string; links: string[]; submittedAt: string; late: boolean; score?: number; feedback?: string }[] }[];
}
export interface StudentAssignment {
  id: string; courseId: string; courseTitle: string; title: string; instructions: string; dueAt: string; points: number; status: string; lateUntil: string | null; latePenaltyPercent: number; maxAttempts: number;
  allowLinks: boolean; attachments: { assetId: string; name: string; url: string }[]; rubric: Rubric | null;
  submission?: { id: string; answerText: string; files: AssignmentFile[]; links: string[]; late: boolean; attemptCount: number; submittedAt: string; score?: number; feedback?: string; status: string };
}

const base = (courseId: string) => `/assessments/${encodeURIComponent(courseId)}`;
const send = async <T>(path: string, method = 'GET', body?: unknown) => (await apiRequest<{ data: T }>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).data;

export const assessmentApi = {
  banks: (courseId: string) => send<Bank[]>(`${base(courseId)}/banks`),
  createBank: (courseId: string, input: { title: string; description?: string }) => send<Bank>(`${base(courseId)}/banks`, 'POST', input),
  copyBank: (courseId: string, bankId: string, targetCourseId: string) => send<{ id: string; questionCount: number }>(`${base(courseId)}/banks/${bankId}/copy`, 'POST', { targetCourseId }),
  questions: (courseId: string, bankId: string) => send<Question[]>(`${base(courseId)}/banks/${bankId}/questions`),
  createQuestion: (courseId: string, bankId: string, input: QuestionInput) => send<Question>(`${base(courseId)}/banks/${bankId}/questions`, 'POST', input),
  updateQuestion: (courseId: string, questionId: string, input: QuestionInput) => send<Question>(`${base(courseId)}/questions/${questionId}`, 'PUT', input),
  deleteQuestion: (courseId: string, questionId: string) => send<{ id: string }>(`${base(courseId)}/questions/${questionId}`, 'DELETE'),
  tests: (courseId: string) => send<TestDefinition[]>(`${base(courseId)}/tests`),
  createTest: (courseId: string, input: TestInput) => send<TestDefinition>(`${base(courseId)}/tests`, 'POST', input),
  updateTest: (courseId: string, testId: string, input: Partial<TestInput>) => send<TestDefinition>(`${base(courseId)}/tests/${testId}`, 'PATCH', input),
  setTestStatus: (courseId: string, testId: string, status: 'published' | 'closed' | 'draft') => send<TestDefinition & { maxPoints?: number | null }>(`${base(courseId)}/tests/${testId}/publish`, 'POST', { status }),
  deleteTest: (courseId: string, testId: string) => send<{ id: string }>(`${base(courseId)}/tests/${testId}`, 'DELETE'),
  attempts: (courseId: string, testId: string) => send<TeacherAttempt[]>(`${base(courseId)}/tests/${testId}/attempts`),
  gradeAttempt: (courseId: string, attemptId: string, scores: { questionId: string; score: number; feedback: string }[]) => send<TeacherAttempt>(`${base(courseId)}/attempts/${attemptId}/grade`, 'PATCH', { scores }),
  studentTests: (courseId: string) => send<StudentTest[]>(`${base(courseId)}/student/tests`),
  startAttempt: (courseId: string, testId: string) => send<StudentAttempt>(`${base(courseId)}/student/tests/${testId}/attempts`, 'POST', {}),
  attempt: (courseId: string, attemptId: string) => send<StudentAttempt>(`${base(courseId)}/student/attempts/${attemptId}`),
  saveAnswers: (courseId: string, attemptId: string, answers: AttemptAnswer[]) => send<{ savedAt: string; answers: AttemptAnswer[] }>(`${base(courseId)}/student/attempts/${attemptId}/answers`, 'PUT', { answers: answers.map(({ savedAt: _savedAt, ...answer }) => answer) }),
  submitAttempt: (courseId: string, attemptId: string) => send<StudentAttempt>(`${base(courseId)}/student/attempts/${attemptId}/submit`, 'POST', {}),
  rubrics: (courseId: string) => send<Rubric[]>(`${base(courseId)}/rubrics`),
  createRubric: (courseId: string, input: RubricInput) => send<Rubric>(`${base(courseId)}/rubrics`, 'POST', input),
  updateRubric: (courseId: string, rubricId: string, input: RubricInput) => send<Rubric>(`${base(courseId)}/rubrics/${rubricId}`, 'PUT', input),
  forms: (courseId: string) => send<CourseForm[]>(`${base(courseId)}/forms`),
  createForm: (courseId: string, input: Pick<CourseForm, 'title' | 'description' | 'anonymous' | 'questions'> & { availableFrom?: string | null; availableUntil?: string | null }) => send<CourseForm>(`${base(courseId)}/forms`, 'POST', input),
  updateForm: (courseId: string, formId: string, input: Partial<CourseForm>) => send<CourseForm>(`${base(courseId)}/forms/${formId}`, 'PATCH', input),
  formResults: (courseId: string, formId: string) => send<FormResults>(`${base(courseId)}/forms/${formId}/responses`),
  studentForms: (courseId: string) => send<CourseForm[]>(`${base(courseId)}/student/forms`),
  answerForm: (courseId: string, formId: string, answers: { questionId: string; values: string[] }[]) => send<{ formId: string }>(`${base(courseId)}/student/forms/${formId}/responses`, 'POST', { answers }),
  courseAssignments: (courseId: string) => send<CourseAssignment[]>(`/assignments/course/${encodeURIComponent(courseId)}`),
  createAssignment: (input: { courseId: string; title: string; instructions: string; dueAt: string; points: number; status: 'draft' | 'published'; lateUntil?: string | null; latePenaltyPercent?: number; maxAttempts?: number; rubricId?: string | null; allowLinks?: boolean }) => send<{ id: string }>('/assignments', 'POST', input),
  updateAssignment: (assignmentId: string, input: Record<string, unknown>) => send<{ id: string }>(`/assignments/${assignmentId}`, 'PATCH', input),
  gradeSubmission: (assignmentId: string, submissionId: string, input: { score?: number; rubricRatings?: { criterionId: string; levelId: string }[]; feedback: string }) => send<{ score: number; rawScore: number; penaltyPercent: number }>(`/assignments/${assignmentId}/submissions/${submissionId}/grade`, 'PATCH', input),
  studentAssignments: () => send<StudentAssignment[]>('/assignments'),
  submitAssignment: async (assignmentId: string, input: { answerText: string; links: string[]; files: File[] }) => {
    const body = new FormData();
    body.append('answerText', input.answerText);
    input.links.forEach(link => body.append('links', link));
    input.files.forEach(file => body.append('files', file));
    return (await apiRequest<{ data: { id: string; late: boolean; attemptCount: number } }>(`/assignments/${assignmentId}/submissions`, { method: 'POST', body })).data;
  },
};
