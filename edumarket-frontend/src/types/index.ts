export type UserRole = 
  | 'visitor'
  | 'student' 
  | 'teacher' 
  | 'unverified_teacher' 
  | 'institution' 
  | 'admin' 
  | 'moderator';

export type LanguageCode = 'fr' | 'en' | 'ar';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: UserRole;
  verified?: boolean;
  emailVerified?: boolean;
  status: 'active' | 'pending' | 'suspended';
  bio?: string;
  headline?: string;
  institutionId?: string;
  joinedDate: string;
  phone?: string;
  website?: string;
  socials?: {
    twitter?: string;
    linkedin?: string;
    github?: string;
  };
  unreadNotificationsCount?: number;
  unreadMessagesCount?: number;
}

export interface CourseLessonResource {
  id: string;
  title: string;
  type: 'pdf' | 'zip' | 'code' | 'link';
  size?: string;
  url: string;
}

export interface CourseQuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctOptionIndex?: number;
  explanation?: string;
}

export interface CourseQuiz {
  id: string;
  title: string;
  durationMinutes: number;
  passPercentage: number;
  questions: CourseQuizQuestion[];
}

export type ContentVisibility = 'hidden' | 'visible';
export type CodeLanguage = 'typescript' | 'javascript' | 'html' | 'css' | 'scss' | 'json' | 'bash' | 'python' | 'java' | 'sql' | 'plaintext';
/** File referenced by a block, resolved by the API (null when the file no longer exists). */
export interface BlockAsset { url: string; name: string; size: number; mimeType: string }
export type LessonBlock =
  | { id: string; type: 'text'; html: string }
  | { id: string; type: 'html'; html: string; title?: string }
  | { id: string; type: 'code'; language: CodeLanguage; code: string; filename?: string; caption?: string }
  | { id: string; type: 'image'; assetId?: string; url?: string; alt: string; decorative?: boolean; caption?: string; asset?: BlockAsset | null }
  | { id: string; type: 'video'; title: string; assetId?: string; embedUrl?: string; captionsAssetId?: string; transcript?: string; asset?: BlockAsset | null; captionsUrl?: string }
  | { id: string; type: 'file'; assetId: string; title?: string; asset?: BlockAsset | null }
  | { id: string; type: 'quiz' }
  | { id: string; type: 'divider' }
  | { id: string; type: 'math'; latex: string; display: 'block' | 'inline'; description?: string };
export type LessonBlockType = LessonBlock['type'];

export interface CourseLesson {
  id: string;
  title: string;
  chapterId: string;
  durationMinutes: number;
  type: 'video' | 'text' | 'interactive' | 'link' | 'lti' | 'scorm';
  /** `lti` items: registered LTI 1.3 tool; `scorm` items: imported package of the course. */
  ltiToolId?: string;
  scormPackageId?: string;
  videoUrl?: string;
  textContent?: string;
  completed?: boolean;
  resources: CourseLessonResource[];
  quiz?: CourseQuiz;
  commentsCount: number;
  description?: string;
  /** Link items: external destination, opened in a new tab. */
  url?: string;
  openInNewTab?: boolean;
  blocks?: LessonBlock[];
  visibility?: ContentVisibility;
  availableFrom?: string | null;
  availableUntil?: string | null;
  /** Optimistic-locking counter of the item content. */
  revision?: number;
  /** Learner view: item of a sequential module not unlocked yet (content withheld by the API). */
  locked?: boolean;
  /** Authors only: pending changes of a published item (students keep the published fields until publication). */
  draft?: LessonDraft;
  publicationStatus?: PublicationStatus;
  publishedVersion?: number;
  publishedAt?: string;
  scheduledPublishAt?: string | null;
}

export type PublicationStatus = 'draft' | 'scheduled' | 'published' | 'pending_changes';
export type LessonDraft = Partial<Pick<CourseLesson, 'title' | 'description' | 'type' | 'durationMinutes' | 'url' | 'openInNewTab' | 'blocks' | 'quiz' | 'textContent'>> & { updatedAt?: string };
export interface ContentVersionEntry { version: number; title: string; publishedAt: string; origin: 'manual' | 'scheduled' | 'legacy' | 'visibility'; publishedBy: string; snapshot: LessonDraft }

export interface CourseChapter {
  id: string;
  title: string;
  order: number;
  lessons: CourseLesson[];
  kind?: 'module' | 'folder';
  description?: string;
  visibility?: ContentVisibility;
  availableFrom?: string | null;
  availableUntil?: string | null;
  sequential?: boolean;
  thumbnail?: { assetId: string; alt: string };
  thumbnailUrl?: string;
}

export interface CourseSyllabusEntry { id: string; title: string; description?: string; startsAt: string; durationMinutes: number }
export interface CourseSettings { language: 'fr' | 'en' | 'ar'; startsAt: string | null; endsAt: string | null; notifyStudents: boolean; timezone?: string | null }

export interface CourseReview {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  rating: number;
  comment: string;
  date: string;
  verifiedPurchase: boolean;
}

export interface Course {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  coverImage: string;
  category: string;
  subCategory?: string;
  tags: string[];
  level: 'beginner' | 'intermediate' | 'advanced' | 'all';
  price: number;
  /** Edit view only: false for co-owners and coordinators (price/status stay with the primary owner). */
  canManageCommercial?: boolean;
  /** `restricted`: only members of the classes the course is assigned to can see it. */
  visibility?: 'public' | 'restricted';
  coOwners?: { id: string; name: string; email: string }[];
  /** Course identifier shown to students (e.g. "ACC-2026"). */
  courseCode?: string;
  /** Teaching access: private hides the content from students, completed keeps it read-only. */
  accessState?: 'open' | 'private' | 'completed';
  settings?: CourseSettings;
  syllabus?: CourseSyllabusEntry[];
  banner?: { assetId: string; alt: string };
  bannerUrl?: string;
  structureVersion?: number;
  isFree: boolean;
  discountPrice?: number;
  rating: number;
  ratingCount: number;
  studentsCount: number;
  totalDurationMinutes: number;
  language: string;
  teacherId: string;
  teacherName: string;
  teacherAvatar: string;
  teacherTitle: string;
  institutionId?: string;
  institutionName?: string;
  status: 'draft' | 'pending' | 'pending_review' | 'published' | 'unpublished' | 'rejected' | 'suspended';
  review?: { submittedAt?: string | null; reviewedAt?: string | null; note?: string };
  chapters: CourseChapter[];
  hasCertification: boolean;
  certificationPathway: 'learning_and_quiz' | 'online_exam' | 'in_person_exam' | 'both';
  examId?: string;
  prerequisites: string[];
  learningOutcomes: string[];
  updatedAt: string;
}

export interface Exam {
  id: string;
  courseId: string;
  courseTitle: string;
  title: string;
  description: string;
  type: 'online' | 'in_person';
  fee: number;
  durationMinutes: number;
  passPercentage: number;
  date?: string;
  location?: {
    venue: string;
    address: string;
    city: string;
    capacity: number;
    enrolledCount: number;
  };
  totalQuestions: number;
  isEnrolled?: boolean;
  userResult?: {
    score: number;
    passed: boolean;
    date: string;
    certificateIssued?: boolean;
  };
  questions?: ExamQuestion[];
  startedAt?: string;
  submittedAt?: string;
}

export interface ExamQuestion {
  id: string;
  question: string;
  options: string[];
}

export interface ExamAttemptResult {
  score: number;
  passed: boolean;
  passPercentage: number;
  submittedAt: string;
  certificateIssued: boolean;
}

export interface Certificate {
  id: string;
  code: string;
  userId: string;
  userName: string;
  courseId: string;
  courseTitle: string;
  issueDate: string;
  expiryDate?: string;
  grade: string;
  instructorName: string;
  institutionName?: string;
  verificationUrl: string;
  status?: 'valid' | 'revoked';
}

export interface AssignmentSubmission {
  id: string;
  studentId?: string;
  studentName?: string;
  answerText: string;
  files?: { name: string; type: string; url: string }[];
  status: 'submitted' | 'graded';
  submittedAt: string;
  score?: number;
  feedback?: string;
}

export interface Assignment {
  id: string;
  courseId: string;
  courseTitle: string;
  title: string;
  instructions: string;
  dueAt: string;
  points: number;
  status: 'draft' | 'published' | 'closed' | 'open' | 'overdue' | 'submitted' | 'graded';
  submission?: AssignmentSubmission;
  submissions?: AssignmentSubmission[];
}

export interface TutoringSession {
  id: string;
  teacherId: string;
  teacherName: string;
  teacherAvatar: string;
  studentId: string;
  studentName: string;
  studentAvatar: string;
  subject: string;
  notes: string;
  type: 'online' | 'in_person';
  status: 'available' | 'pending' | 'confirmed' | 'rejected' | 'completed' | 'cancelled';
  paymentStatus?: 'not_required' | 'awaiting_payment' | 'paid' | 'refunded';
  /** ISO instants (API mode). */
  startAt?: string;
  endAt?: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  price: number;
  jitsiRoomId?: string;
  meetingUrl?: string;
  location?: {
    venue: string;
    address: string;
    city: string;
  };
  googleCalendarSynced?: boolean;
  rating?: number;
  reviewComment?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  text?: string;
  voiceUrl?: string;
  voiceDurationSeconds?: number;
  attachment?: {
    name: string;
    size: string;
    url: string;
  };
  timestamp: string;
  read: boolean;
  hidden?: boolean;
}

export interface Conversation {
  id: string;
  participants: User[];
  lastMessage: Message;
  unreadCount: number;
  updatedAt: string;
}

export interface ForumPost {
  id: string;
  title: string;
  content: string;
  category: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  authorRole: string;
  createdAt: string;
  upvotes: number;
  repliesCount: number;
  isSolved: boolean;
  solvedReplyId?: string;
  viewsCount: number;
  tags: string[];
  isUpvoted?: boolean;
}

export interface ForumReply {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  authorRole: string;
  content: string;
  createdAt: string;
  upvotes: number;
  isSolution: boolean;
}

export interface Notification {
  id: string;
  userId: string;
  type: 'purchase' | 'subscription' | 'session' | 'course' | 'exam' | 'message' | 'certificate' | 'account' | 'system';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  link?: string;
  /** Translation key and parameters sent by the API; title/message are the English fallback. */
  template?: { key: string; params?: Record<string, string | number> };
}

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  currency: string;
  status: 'succeeded' | 'pending' | 'failed' | 'refunded';
  type: 'course_purchase' | 'subscription' | 'exam_fee' | 'tutoring_session' | 'payout';
  itemName: string;
  sellerCommission: number;
  platformFee: number;
  paymentMethod: string;
  invoiceUrl: string;
  userId: string;
  userName: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  features: string[];
  popular?: boolean;
  currentPlan?: boolean;
}

export interface Institution {
  id: string;
  name: string;
  slug: string;
  logo: string;
  banner: string;
  description: string;
  country: string;
  city: string;
  website: string;
  verified: boolean;
  teachersCount: number;
  coursesCount: number;
  studentsCount: number;
  rating: number;
  joinedDate: string;
  contactEmail: string;
}

export interface TeacherVerificationRequest {
  id: string;
  teacherId: string;
  teacherName: string;
  email: string;
  specialty: string;
  registrationNumber?: string;
  credentialsSummary?: string;
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  documents: {
    name: string;
    type: string;
    url: string;
  }[];
  notes?: string;
}

export interface AuditLog {
  id: string;
  action: string;
  performedBy: string;
  target: string;
  ipAddress: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
}
