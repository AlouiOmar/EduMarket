/** DTOs of the marketplace, moderation, support, calendar and analytics APIs. Amounts are integer minor units. */
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type OrderItemType = 'course' | 'exam' | 'session' | 'subscription';

export interface PaymentConfig { enabled: boolean; provider: 'sandbox' | 'stripe' | null; sandbox: boolean; currency: string; commissionRate: number; offline?: { enabled: boolean; instructions: string } }
export type OfflineMethod = 'cash' | 'cheque' | 'bank_transfer';
export type PaymentMethod = 'online' | OfflineMethod;
export interface CheckoutSession { orderId: string; status: OrderStatus; provider: string; checkoutUrl: string; totalAmount: number; currency: string; expiresAt: string }

export interface OrderItem { itemType: OrderItemType; itemId: string; title: string; unitAmount: number; sellerId?: string; sellerName?: string; platformFee?: number; sellerAmount?: number; commissionRate?: number }
export interface Order {
  id: string; status: OrderStatus; currency: string; totalAmount: number; provider: string; items: OrderItem[];
  checkoutUrl?: string; invoiceNumber: string | null; paidAt: string | null; createdAt: string; failureReason: string;
  refund: { refundedAt: string; reason: string } | null;
  student?: { id: string; name?: string; email?: string };
  paymentMethod?: PaymentMethod; expiresAt?: string;
  offlinePayment?: { reference: string; receivedAt: string; hasProof: boolean; bankName?: string; payerName?: string; note?: string; recordedBy?: string; recordedAt?: string } | null;
}
export interface Invoice {
  invoiceNumber: string; issuedAt: string; status: OrderStatus; currency: string; totalAmount: number; pricesIncludeTax: boolean;
  buyer: { name: string; email: string }; lines: { description: string; itemType: OrderItemType; seller: string; amount: number }[];
  refund: { refundedAt: string } | null;
  paymentMethod?: PaymentMethod; paymentReference?: string;
}

export interface SellerBalance { currency: string; earned: number; refunded: number; pending: number; platformFees: number; requestedPayouts: number; paidOut: number; available: number; payoutMinimum: number; holdDays: number }
export type LedgerType = 'sale' | 'refund' | 'affiliation_share' | 'affiliation_share_refund' | 'subscription_share' | 'subscription_share_refund';
export interface LedgerEntry { id: string; type: LedgerType; itemType: OrderItemType; title: string; grossAmount: number; platformFee: number; amount: number; currency: string; availableAt: string; createdAt: string }
export interface Payout { id: string; amount: number; currency: string; status: 'requested' | 'paid' | 'rejected'; reference: string; note: string; createdAt: string; processedAt: string | null; seller?: { id: string; name: string; email: string; role: string } }
export interface PaymentSummary { currency: string; provider: string | null; grossRevenue: number; platformFees: number; paidOrders: number; refundedAmount: number; refundedOrders: number; pendingPayouts: number; pendingPayoutCount: number; paidPayouts: number }

export type CourseStatus = 'draft' | 'pending_review' | 'published' | 'rejected' | 'suspended';
export interface ModerationCourse {
  id: string; title: string; slug: string; category: string; price: number; status: CourseStatus; teacherId: string; teacherName: string;
  lessonsCount: number; studentsCount: number; rating: number; review: { submittedAt: string | null; reviewedAt: string | null; note: string }; createdAt: string; updatedAt: string;
}
export interface ModerationSummary { pendingCourses: number; suspendedCourses: number; openForumReports: number; hiddenReviews: number; openContentReports: number }
export interface ModerationEvent { id: string; action: string; actorName: string; actorRole: string; targetType: string; targetId: string; severity: 'info' | 'warning' | 'critical'; createdAt: string }
export interface AuditEntry { id: string; action: string; performedBy: string; actorRole: string; targetType: string; targetId: string; target: string; ipAddress: string; severity: 'info' | 'warning' | 'critical'; timestamp: string }
export interface Pagination { page: number; limit: number; total: number; pages: number }

export type TicketStatus = 'open' | 'pending_user' | 'resolved' | 'closed';
export type TicketCategory = 'account' | 'billing' | 'course' | 'technical' | 'other';
export interface SupportTicket {
  id: string; subject: string; category: TicketCategory; priority: 'low' | 'normal' | 'high'; status: TicketStatus; relatedOrderId: string | null; createdAt: string; lastActivityAt: string;
  messages: { id: string; authorRole: 'requester' | 'staff'; authorName: string; body: string; createdAt: string }[];
  requester?: { id: string; name?: string; email?: string; role?: string }; assignee?: { id: string; name: string } | null;
}

export interface CalendarEvent { id: string; kind: 'session' | 'exam'; sourceId: string; status: string; mode: 'online' | 'in_person'; title: string; counterpart: string; start: string; end: string; location: string }
export interface GoogleCalendarStatus { configured: boolean; connected: boolean; connectedAt: string | null }

export interface ManagedCategory { id: string; slug: string; names: { fr: string; en: string; ar: string }; active: boolean; order: number; coursesCount: number }
export interface PublicCategory { id: string; name: string; names: { fr: string; en: string; ar: string } | null; coursesCount: number }

export interface AdminOverview {
  users: { total: number; byRole: Record<string, number>; byStatus: Record<string, number> };
  courses: { byStatus: Record<string, number> }; learning: { enrollments: number; completedEnrollments: number; certificates: number };
  queues: { pendingTeachers: number; pendingInstitutions: number; pendingCourseReviews: number; openReports: number; openTickets: number };
  revenue: { grossAmount: number; paidOrders: number }; dailySignups: { date: string; count: number }[];
}
export interface InstitutionAnalytics {
  totals: { courses: number; publishedCourses: number; enrollments: number; uniqueStudents: number; completionRate: number | null; averageProgress: number | null; examAverageScore: number | null; examPassRate: number | null };
  courses: { courseId: string; title: string; status: CourseStatus; teacherName: string; enrollments: number; completions: number; averageProgress: number; quizPassRate: number | null }[];
  students: { studentId: string; name: string; email: string; courseId: string; courseTitle: string; progress: number; enrolledAt: string; completedAt: string | null }[];
}

export type SubscriptionPlan = 'monthly' | 'yearly';
export interface SubscriptionOffer { enabled: boolean; monthlyPrice: number; yearlyPrice: number }
export interface SubscriptionStatus {
  active: boolean; plan: SubscriptionPlan | null; currentPeriodEnd: string | null; cancelledAt: string | null;
  periods: { id: string; orderId: string; plan: SubscriptionPlan; startsAt: string; endsAt: string; amount: number; currency: string; status: 'active' | 'refunded' }[];
}

export type ReportTarget = 'course' | 'course_review' | 'message' | 'user';
export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'copyright' | 'misinformation' | 'other';
export interface ContentReport {
  id: string; targetType: ReportTarget; targetId: string; reason: ReportReason; details: string;
  snapshot: { title: string; excerpt: string; ownerName: string }; reporter: { id: string; name: string } | null;
  status: 'open' | 'escalated' | 'actioned' | 'dismissed'; decisionNote: string; createdAt: string; reviewedAt: string | null;
}

export interface LocalizedText { fr: string; en: string; ar: string }
export interface LearningPathSummary {
  id: string; slug: string; title: LocalizedText; description: LocalizedText; skills: string[]; coursesCount: number; durationMinutes: number;
  courseIds?: string[]; courses?: import('./index').Course[]; progress?: { enrolled: number; completed: number };
}
export interface AdminLearningPath { id: string; slug: string; title: LocalizedText; description: LocalizedText; skills: string[]; courseIds: string[]; active: boolean; order: number }

export interface CoOwner { id: string; name: string; email: string }
export interface ManagedReview {
  id: string; courseId: string; courseTitle: string; rating: number; comment: string; createdAt: string; studentName: string;
  reply: { body: string; repliedAt: string } | null;
}
export interface AdminExam {
  id: string; title: string; type: 'online' | 'in_person'; status: 'draft' | 'published'; fee: number; date: string | null;
  registeredCount: number; capacity: number | null; city: string; courseTitle: string; creatorName: string; createdAt: string;
}
export interface AdminCertificate {
  id: string; code: string; issuedAt: string; student: { id: string; name: string; email: string }; courseTitle: string;
  status: 'valid' | 'revoked'; revokedAt: string | null; revokedReason: string;
}
export interface AdminUserDetail {
  id: string; name: string; email: string; role: string; verified: boolean; status: 'active' | 'suspended'; createdAt: string;
  headline: string; phone: string; teacherVerificationStatus: string | null;
  affiliation: { institutionId: string; institutionName: string; internalRole: string; revenueSharePercent: number } | null;
  stats: {
    enrollments: number; certificates: number; supportTickets: number; reportsAgainst: number;
    coursesByStatus: Record<string, number>; ordersByStatus: Record<string, { count: number; amount: number }>;
  };
  audit: { id: string; action: string; actor: string; severity: 'info' | 'warning' | 'critical'; createdAt: string }[];
}

export interface ClassSummary {
  id: string; name: string; level: string; academicYear: string; description: string; ownerRole: 'teacher' | 'institution'; ownerName: string;
  joinCode: string; joinEnabled: boolean; archived: boolean; studentsCount: number; coursesCount: number; createdAt: string;
}
export interface ClassDetail extends ClassSummary {
  courses: { id: string; title: string; status: CourseStatus; visibility: 'public' | 'restricted'; teacherName: string }[];
  students: { id: string; name: string; email: string; status: string; progress: { courseId: string; percent: number; completed: boolean }[] }[];
}
export interface StudentClass {
  id: string; name: string; level: string; academicYear: string; description: string; ownerRole: 'teacher' | 'institution'; ownerName: string;
  courses: import('./index').Course[];
}
export type CloudProviderName = 'google_drive' | 'onedrive';
export interface StorageAccount {
  id: string; provider: CloudProviderName; accountEmail: string; displayName: string; isDefault: boolean; status: 'connected' | 'reconnect_required';
  connectedAt: string; platformFiles?: number; quota: { total: number | null; used: number; free: number | null; checkedAt: string | null };
}

