import { apiRequest, downloadApiFile, queryString } from './apiClient';
import type {
  AdminOverview, AuditEntry, CalendarEvent, CheckoutSession, GoogleCalendarStatus, InstitutionAnalytics, Invoice, LedgerEntry, ManagedCategory,
  AdminLearningPath, AdminCertificate, ClassDetail, ClassSummary, OfflineMethod, StorageAccount, StudentClass, CloudProviderName, AdminExam, AdminUserDetail, ContentReport, CoOwner, ManagedReview, LearningPathSummary, ModerationCourse, ModerationEvent, ReportReason, ReportTarget, SubscriptionOffer, SubscriptionPlan, SubscriptionStatus, ModerationSummary, Order, Pagination, Payout, PaymentConfig, PaymentSummary, PublicCategory, SellerBalance, SupportTicket, TicketCategory,
} from '../types/platform';

/**
 * API clients for the marketplace, moderation, support, calendar and analytics modules.
 * These domains have no demo data: pages render an explicit "API mode required" state when VITE_DATA_MODE=mock.
 */
type Envelope<T> = { success: boolean; data: T };
type PageEnvelope<T> = { success: boolean; data: T[]; pagination: Pagination };
const json = (method: string, body?: unknown, headers?: Record<string, string>): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(headers ? { headers } : {}) });
const newIdempotencyKey = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, '');

export const paymentApi = {
  config: async () => (await apiRequest<Envelope<PaymentConfig>>('/payments/config')).data,
  checkoutCourses: async (courseIds: string[], idempotencyKey = newIdempotencyKey()) =>
    (await apiRequest<Envelope<CheckoutSession>>('/payments/checkout', json('POST', { courseIds }, { 'Idempotency-Key': idempotencyKey }))).data,
  checkoutExam: async (examId: string) =>
    (await apiRequest<Envelope<CheckoutSession>>(`/payments/checkout/exams/${encodeURIComponent(examId)}`, json('POST', undefined, { 'Idempotency-Key': newIdempotencyKey() }))).data,
  checkoutSession: async (sessionId: string, booking: { subject: string; notes?: string }) =>
    (await apiRequest<Envelope<CheckoutSession>>(`/payments/checkout/sessions/${encodeURIComponent(sessionId)}`, json('POST', booking, { 'Idempotency-Key': newIdempotencyKey() }))).data,
  myOrders: async () => (await apiRequest<Envelope<Order[]>>('/payments/orders/mine')).data,
  order: async (orderId: string) => (await apiRequest<Envelope<Order>>(`/payments/orders/${encodeURIComponent(orderId)}`)).data,
  invoice: async (orderId: string) => (await apiRequest<Envelope<Invoice>>(`/payments/orders/${encodeURIComponent(orderId)}/invoice`)).data,
  completeSandbox: async (sessionId: string, outcome: 'complete' | 'fail') =>
    (await apiRequest<Envelope<Order>>(`/payments/sandbox/sessions/${encodeURIComponent(sessionId)}/${outcome}`, json('POST'))).data,
  earnings: async () => (await apiRequest<Envelope<{ balance: SellerBalance; entries: LedgerEntry[] }>>('/payments/earnings')).data,
  myPayouts: async () => (await apiRequest<Envelope<Payout[]>>('/payments/payouts/mine')).data,
  requestPayout: async () => (await apiRequest<Envelope<Payout>>('/payments/payouts', json('POST', {}))).data,
};

export const adminPaymentApi = {
  summary: async () => (await apiRequest<Envelope<PaymentSummary>>('/admin/payments/summary')).data,
  orders: async (params: { status?: string; page?: number }) => apiRequest<PageEnvelope<Order>>(`/admin/payments/orders${queryString(params)}`),
  refund: async (orderId: string, reason: string) => (await apiRequest<Envelope<Order>>(`/admin/payments/orders/${encodeURIComponent(orderId)}/refund`, json('POST', { reason }))).data,
  payouts: async (status = 'requested') => (await apiRequest<Envelope<Payout[]>>(`/admin/payments/payouts${queryString({ status })}`)).data,
  processPayout: async (payoutId: string, input: { status: 'paid' | 'rejected'; reference?: string; note?: string }) =>
    (await apiRequest<Envelope<Payout>>(`/admin/payments/payouts/${encodeURIComponent(payoutId)}`, json('PATCH', input))).data,
};

export const moderationApi = {
  summary: async () => (await apiRequest<Envelope<ModerationSummary>>('/moderation/summary')).data,
  courses: async (params: { status?: string; search?: string; page?: number }) => apiRequest<PageEnvelope<ModerationCourse>>(`/moderation/courses${queryString(params)}`),
  reviewCourse: async (courseId: string, decision: 'approve' | 'reject', note: string) =>
    (await apiRequest<Envelope<ModerationCourse>>(`/moderation/courses/${encodeURIComponent(courseId)}/review`, json('PATCH', { decision, note }))).data,
  setSuspension: async (courseId: string, suspended: boolean, note: string) =>
    (await apiRequest<Envelope<ModerationCourse>>(`/moderation/courses/${encodeURIComponent(courseId)}/suspension`, json('PATCH', { suspended, note }))).data,
  history: async (page = 1) => apiRequest<PageEnvelope<ModerationEvent>>(`/moderation/history${queryString({ page })}`),
};

export const courseWorkflowApi = {
  submitForReview: async (courseId: string) => (await apiRequest<Envelope<{ status: string }>>(`/courses/${encodeURIComponent(courseId)}/submit-review`, json('POST'))).data,
  categories: async () => (await apiRequest<Envelope<PublicCategory[]>>('/courses/categories')).data,
};

export const adminCatalogApi = {
  categories: async () => (await apiRequest<Envelope<ManagedCategory[]>>('/admin/categories')).data,
  createCategory: async (input: { slug: string; names: ManagedCategory['names'] }) => (await apiRequest<Envelope<ManagedCategory>>('/admin/categories', json('POST', input))).data,
  updateCategory: async (id: string, input: Partial<Pick<ManagedCategory, 'names' | 'active' | 'order'>>) =>
    (await apiRequest<Envelope<ManagedCategory>>(`/admin/categories/${encodeURIComponent(id)}`, json('PATCH', input))).data,
  deleteCategory: async (id: string) => { await apiRequest<void>(`/admin/categories/${encodeURIComponent(id)}`, json('DELETE')); },
  auditLogs: async (params: { action?: string; severity?: string; page?: number }) => apiRequest<PageEnvelope<AuditEntry>>(`/admin/audit-logs${queryString(params)}`),
  overview: async () => (await apiRequest<Envelope<AdminOverview>>('/analytics/admin/overview')).data,
};

export const supportApi = {
  contact: async (input: { name: string; email: string; subject?: string; message: string }) => (await apiRequest<Envelope<{ id: string }>>('/support/contact', json('POST', input))).data,
  mine: async () => (await apiRequest<Envelope<SupportTicket[]>>('/support/tickets')).data,
  create: async (input: { subject: string; category: TicketCategory; message: string; relatedOrderId?: string }) =>
    (await apiRequest<Envelope<SupportTicket>>('/support/tickets', json('POST', input))).data,
  reply: async (ticketId: string, body: string) => (await apiRequest<Envelope<SupportTicket>>(`/support/tickets/${encodeURIComponent(ticketId)}/messages`, json('POST', { body }))).data,
  close: async (ticketId: string) => (await apiRequest<Envelope<SupportTicket>>(`/support/tickets/${encodeURIComponent(ticketId)}/close`, json('PATCH'))).data,
  staffQueue: async (params: { status?: string; page?: number }) => apiRequest<PageEnvelope<SupportTicket>>(`/admin/support/tickets${queryString(params)}`),
  staffReply: async (ticketId: string, body: string, status: 'pending_user' | 'resolved') =>
    (await apiRequest<Envelope<SupportTicket>>(`/admin/support/tickets/${encodeURIComponent(ticketId)}/messages`, json('POST', { body, status }))).data,
  staffUpdate: async (ticketId: string, input: { status?: string; priority?: string }) =>
    (await apiRequest<Envelope<SupportTicket>>(`/admin/support/tickets/${encodeURIComponent(ticketId)}`, json('PATCH', input))).data,
};

export const calendarApi = {
  events: async () => (await apiRequest<Envelope<CalendarEvent[]>>('/calendar/events')).data,
  googleStatus: async () => (await apiRequest<Envelope<GoogleCalendarStatus>>('/calendar/google/status')).data,
  connectGoogle: async () => (await apiRequest<Envelope<{ authorizationUrl: string }>>('/calendar/google/connect', json('POST'))).data.authorizationUrl,
  disconnectGoogle: async () => { await apiRequest<void>('/calendar/google', json('DELETE')); },
};

export const analyticsApi = {
  institution: async () => (await apiRequest<Envelope<InstitutionAnalytics>>('/analytics/institution')).data,
  teacher: async () => (await apiRequest<Envelope<InstitutionAnalytics>>('/analytics/teacher')).data,
};

export const courseTeamApi = {
  setCoOwners: async (courseId: string, emails: string[]) => (await apiRequest<Envelope<CoOwner[]>>(`/courses/${encodeURIComponent(courseId)}/co-owners`, json('PUT', { emails }))).data,
  managedReviews: async () => (await apiRequest<Envelope<ManagedReview[]>>('/courses/reviews/managed')).data,
  replyToReview: async (courseId: string, reviewId: string, body: string) =>
    (await apiRequest<Envelope<{ id: string; reply: ManagedReview['reply'] }>>(`/courses/${encodeURIComponent(courseId)}/reviews/${encodeURIComponent(reviewId)}/reply`, json('PUT', { body }))).data,
};

export const adminRecordsApi = {
  exams: async (params: { type?: string; status?: string; search?: string; page?: number }) => apiRequest<PageEnvelope<AdminExam>>(`/admin/exams${queryString(params)}`),
  setExamStatus: async (examId: string, status: 'draft' | 'published') => (await apiRequest<Envelope<{ id: string; status: string }>>(`/admin/exams/${encodeURIComponent(examId)}`, json('PATCH', { status }))).data,
  certificates: async (params: { search?: string; status?: string; page?: number }) => apiRequest<PageEnvelope<AdminCertificate>>(`/admin/certificates${queryString(params)}`),
  setCertificateStatus: async (certificateId: string, input: { status: 'revoked'; reason: string } | { status: 'valid' }) =>
    (await apiRequest<Envelope<AdminCertificate>>(`/admin/certificates/${encodeURIComponent(certificateId)}`, json('PATCH', input))).data,
  userDetail: async (userId: string) => (await apiRequest<Envelope<AdminUserDetail>>(`/admin/users/${encodeURIComponent(userId)}`)).data,
};

export const classApi = {
  managed: async () => (await apiRequest<Envelope<ClassSummary[]>>('/classes')).data,
  detail: async (classId: string) => (await apiRequest<Envelope<ClassDetail>>(`/classes/${encodeURIComponent(classId)}`)).data,
  create: async (input: { name: string; level?: string; academicYear?: string; description?: string; joinEnabled?: boolean }) => (await apiRequest<Envelope<ClassDetail>>('/classes', json('POST', input))).data,
  update: async (classId: string, input: Partial<{ name: string; level: string; academicYear: string; description: string; joinEnabled: boolean; archived: boolean }>) =>
    (await apiRequest<Envelope<ClassDetail>>(`/classes/${encodeURIComponent(classId)}`, json('PATCH', input))).data,
  remove: async (classId: string) => { await apiRequest<void>(`/classes/${encodeURIComponent(classId)}`, json('DELETE')); },
  setCourses: async (classId: string, courseIds: string[]) => (await apiRequest<Envelope<ClassDetail>>(`/classes/${encodeURIComponent(classId)}/courses`, json('PUT', { courseIds }))).data,
  addStudents: async (classId: string, emails: string[]) => (await apiRequest<Envelope<{ added: number; notFound: string[]; class: ClassDetail }>>(`/classes/${encodeURIComponent(classId)}/students`, json('POST', { emails }))).data,
  removeStudent: async (classId: string, studentId: string) => (await apiRequest<Envelope<ClassDetail>>(`/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}`, json('DELETE'))).data,
  newJoinCode: async (classId: string) => (await apiRequest<Envelope<{ joinCode: string }>>(`/classes/${encodeURIComponent(classId)}/join-code`, json('POST'))).data.joinCode,
  mine: async () => (await apiRequest<Envelope<StudentClass[]>>('/classes/mine')).data,
  join: async (code: string) => (await apiRequest<Envelope<{ id: string; name: string }>>('/classes/join', json('POST', { code }))).data,
};

/** Multipart body of offline payment forms: JSON payload + optional proof scan. */
const offlineForm = (payload: unknown, proof?: File | null) => {
  const form = new FormData();
  form.set('payload', JSON.stringify(payload));
  if (proof) form.set('proof', proof);
  return form;
};
export interface OfflinePaymentDetails { method: OfflineMethod; reference?: string; bankName?: string; payerName?: string; receivedAt?: string; note?: string }
export const offlinePaymentApi = {
  request: async (input: { courseIds?: string[]; plan?: SubscriptionPlan; method: OfflineMethod }) =>
    (await apiRequest<Envelope<{ order: Order; instructions: string }>>('/payments/offline-requests', json('POST', input))).data,
  cancel: async (orderId: string) => (await apiRequest<Envelope<Order>>(`/payments/orders/${encodeURIComponent(orderId)}/cancel`, json('POST'))).data,
  downloadProof: (orderId: string, name = 'payment-proof') => downloadApiFile(`/payments/orders/${encodeURIComponent(orderId)}/offline-proof`, name),
  record: async (orderId: string, payment: OfflinePaymentDetails, proof?: File | null) =>
    (await apiRequest<Envelope<Order>>(`/admin/payments/orders/${encodeURIComponent(orderId)}/offline-payment`, { method: 'POST', body: offlineForm(payment, proof) })).data,
  registerAtDesk: async (target: { studentEmail: string; courseIds: string[]; plan?: SubscriptionPlan }, payment: OfflinePaymentDetails, proof?: File | null) =>
    (await apiRequest<Envelope<Order>>('/admin/payments/offline', { method: 'POST', body: offlineForm({ target, payment }, proof) })).data,
  adminCancel: async (orderId: string) => (await apiRequest<Envelope<Order>>(`/admin/payments/orders/${encodeURIComponent(orderId)}/cancel`, json('POST'))).data,
  adminOrders: async (params: { status?: string; page?: number }) => apiRequest<PageEnvelope<Order>>(`/admin/payments/orders${queryString({ ...params, provider: 'offline' })}`),
};

export const storageApi = {
  providers: async () => (await apiRequest<Envelope<{ provider: CloudProviderName; configured: boolean }[]>>('/storage/providers')).data,
  accounts: async () => (await apiRequest<Envelope<StorageAccount[]>>('/storage/accounts')).data,
  connect: async (provider: CloudProviderName) => (await apiRequest<Envelope<{ authorizationUrl: string }>>('/storage/accounts/connect', json('POST', { provider }))).data.authorizationUrl,
  makeDefault: async (accountId: string) => (await apiRequest<Envelope<StorageAccount>>(`/storage/accounts/${encodeURIComponent(accountId)}`, json('PATCH', { isDefault: true }))).data,
  refresh: async (accountId: string) => (await apiRequest<Envelope<StorageAccount>>(`/storage/accounts/${encodeURIComponent(accountId)}/refresh`, json('POST'))).data,
  disconnect: async (accountId: string) => { await apiRequest<void>(`/storage/accounts/${encodeURIComponent(accountId)}`, json('DELETE')); },
  downloadGrades: (courseId: string) => downloadApiFile('/storage/exports/grades', 'grades.csv', { method: 'POST', body: JSON.stringify({ courseId, destination: 'download' }) }),
  exportGrades: async (courseId: string, destination: string) =>
    (await apiRequest<Envelope<{ fileName: string; webUrl: string; provider: CloudProviderName; accountEmail: string }>>('/storage/exports/grades', json('POST', { courseId, destination }))).data,
};

export const subscriptionApi = {
  offer: async () => (await apiRequest<Envelope<SubscriptionOffer>>('/subscriptions/offer')).data,
  mine: async () => (await apiRequest<Envelope<SubscriptionStatus>>('/subscriptions/me')).data,
  checkout: async (plan: SubscriptionPlan) =>
    (await apiRequest<Envelope<CheckoutSession>>('/subscriptions/checkout', json('POST', { plan }, { 'Idempotency-Key': newIdempotencyKey() }))).data,
  cancel: async () => (await apiRequest<Envelope<SubscriptionStatus>>('/subscriptions/me/cancel', json('POST'))).data,
};

export const reportApi = {
  create: async (input: { targetType: ReportTarget; targetId: string; reason: ReportReason; details?: string }) =>
    (await apiRequest<Envelope<{ id: string }>>('/reports', json('POST', input))).data,
  queue: async (params: { status?: string; targetType?: string; page?: number }) => apiRequest<PageEnvelope<ContentReport>>(`/moderation/reports${queryString(params)}`),
  decide: async (reportId: string, decision: 'actioned' | 'dismissed', note = '') =>
    (await apiRequest<Envelope<ContentReport>>(`/moderation/reports/${encodeURIComponent(reportId)}`, json('PATCH', { decision, note }))).data,
};

export interface LessonQuestionDto { id: string; body: string; createdAt: string; mine: boolean; author: { name: string }; answers: { id: string; body: string; staff: boolean; createdAt: string; author: { name: string } }[] }
const lessonPath = (courseId: string, lessonId: string) => `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/questions`;
export const lessonQaApi = {
  list: async (courseId: string, lessonId: string) => (await apiRequest<Envelope<LessonQuestionDto[]>>(lessonPath(courseId, lessonId))).data,
  ask: async (courseId: string, lessonId: string, body: string) => (await apiRequest<Envelope<LessonQuestionDto>>(lessonPath(courseId, lessonId), json('POST', { body }))).data,
  answer: async (courseId: string, lessonId: string, questionId: string, body: string) =>
    (await apiRequest<Envelope<LessonQuestionDto>>(`${lessonPath(courseId, lessonId)}/${encodeURIComponent(questionId)}/answers`, json('POST', { body }))).data,
};

export const learningPathApi = {
  list: async () => (await apiRequest<Envelope<LearningPathSummary[]>>('/learning-paths')).data,
  adminList: async () => (await apiRequest<Envelope<AdminLearningPath[]>>('/admin/learning-paths')).data,
  create: async (input: Omit<AdminLearningPath, 'id'>) => (await apiRequest<Envelope<{ id: string }>>('/admin/learning-paths', json('POST', input))).data,
  update: async (id: string, input: Omit<AdminLearningPath, 'id'>) => (await apiRequest<Envelope<{ id: string }>>(`/admin/learning-paths/${encodeURIComponent(id)}`, json('PUT', input))).data,
  remove: async (id: string) => { await apiRequest<void>(`/admin/learning-paths/${encodeURIComponent(id)}`, json('DELETE')); },
};
