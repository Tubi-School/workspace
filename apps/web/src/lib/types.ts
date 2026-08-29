/**
 * Shapes mirroring the Phase 2G backend's actual responses (read directly
 * from apps/api/src/**, not guessed). Kept intentionally loose where the
 * backend itself returns a broad Prisma payload — the frontend only ever
 * displays fields it actually reads.
 */

export type RoleName = 'ADMIN' | 'TEACHER' | 'LEARNER';

export type SessionStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELED';
export type TeacherRole = 'PRIMARY' | 'ASSISTANT' | 'SUBSTITUTE';
export type DeliveryMode = 'LIVE_AND_RECORDED' | 'RECORDED_ONLY';
export type CompletionMode = 'LIVE' | 'RECORDED';
export type AttendanceStatus = 'PENDING' | 'PRESENT' | 'ABSENT';
export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
export type ExceptionReason =
  'RECORDING_PROCESSING_DELAY' | 'PLATFORM_OUTAGE' | 'LEARNER_CIRCUMSTANCE' | 'OTHER';

export interface SanitizedUser {
  id: string;
  email: string;
  fullName: string;
  role: RoleName;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GradeLevel {
  id: string;
  name: string;
}

export interface Subject {
  id: string;
  name: string;
}

export interface AcademicTerm {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
}

export interface TeacherProfileSummary {
  id: string;
  bio: string | null;
  createdAt: string;
  userId: string;
}

export interface TeacherWithUser {
  id: string;
  bio: string | null;
  createdAt: string;
  userId: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: RoleName;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
}

export interface LearnerWithUser {
  id: string;
  dateOfBirth: string | null;
  guardianContact: string | null;
  createdAt: string;
  userId: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: RoleName;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
}

export interface CourseWithRelations {
  id: string;
  title: string;
  subjectId: string;
  gradeLevelId: string;
  academicTermId: string;
  primaryTeacherId: string;
  subject: Subject;
  gradeLevel: GradeLevel;
  academicTerm: AcademicTerm;
  primaryTeacher: TeacherProfileSummary;
}

export interface SessionTeacherEntry {
  sessionId: string;
  teacherId: string;
  teacherRole: TeacherRole;
  teacher: TeacherWithUser;
}

/** The admin/teacher session shape — GET /admin/sessions and /admin/sessions/:id.
 * Deliberately has no `recording` relation (the backend include for this
 * surface does not join it — see section R of the Phase 3 review for what
 * that means for this UI). */
export type MeetingProvisioningStatus = 'NOT_REQUIRED' | 'PENDING' | 'PROVISIONED' | 'FAILED';

export interface SessionWithRelations {
  id: string;
  courseId: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  attendanceCutoffAt: string;
  liveMeetingUrl: string;
  status: SessionStatus;
  canceledAt: string | null;
  replacementForSessionId: string | null;
  meetingProvider: string | null;
  meetingProvisioningStatus: MeetingProvisioningStatus;
  meetingProvisioningError: string | null;
  course: {
    id: string;
    title: string;
  };
  teachers: SessionTeacherEntry[];
}

export interface SessionRecording {
  id: string;
  sessionId: string;
  recordingUrl: string;
  availableFrom: string;
  totalSeconds: number;
  /** Set when a provider (Zoom) ingested this recording automatically.
   * `null` for a manually-published recording. See the learner session
   * page for why this changes how playback is offered. */
  provider: string | null;
}

/** The learner-facing session shape — GET /learner/sessions and /learner/sessions/:id.
 * `liveMeetingUrl` is `''` when the caller's own entitlement does not
 * affirmatively resolve to LIVE_AND_RECORDED — the backend redacts it, the
 * frontend must never try to recompute or second-guess that. */
export interface LearnerVisibleSession {
  id: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  liveMeetingUrl: string;
  status: SessionStatus;
  course: {
    id: string;
    title: string;
  };
  recording: SessionRecording | null;
}

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  learnerId: string;
  completionMode: CompletionMode | null;
  completedAt: string | null;
  status: AttendanceStatus;
  createdAt: string;
}

export interface AttendanceRecordWithLearner extends AttendanceRecord {
  learner: {
    id: string;
    user: { id: string; email: string; fullName: string };
  };
}

export interface CoverageSummary {
  liveCoverageMs: number;
  recordedCoverageSeconds: number | null;
}

export interface Offering {
  id: string;
  name: string;
  deliveryMode: DeliveryMode;
  monthlyPrice: string;
}

export interface OfferingWithCourses extends Offering {
  courses: Array<{ courseId: string; course: { id: string; title: string } }>;
}

export interface SubscriptionAccess {
  id: string;
  learnerId: string;
  offeringId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
}

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'REFUNDED';

export interface PaymentOrder {
  id: string;
  learnerId: string;
  offeringId: string;
  provider: string;
  providerReference: string | null;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  createdAt: string;
}

export type NotificationOutboxStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';

export interface NotificationOutboxItem {
  id: string;
  type: string;
  recipientUserId: string;
  status: NotificationOutboxStatus;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
  lastError: string | null;
  recipient: { id: string; email: string; fullName: string } | null;
}

export type ProviderConfigStatus = 'CONFIGURED' | 'NOT_CONFIGURED';

/** `null` means "not queryable right now" (the database is down) — never
 * render this as `0`. */
export type OperationalCount = number | null;

export interface LaunchOperationsReport {
  database: 'ok' | 'down';
  providers: {
    zoom: ProviderConfigStatus;
    payments: ProviderConfigStatus;
    email: ProviderConfigStatus;
  };
  stuckMeetingsCount: OperationalCount;
  permanentlyFailedNotificationsCount: OperationalCount;
  paymentsAwaitingResolutionCount: OperationalCount;
  upcomingSessionsCount: OperationalCount;
}

export interface AttendanceWindowException {
  id: string;
  sessionId: string;
  learnerId: string | null;
  reason: ExceptionReason;
  extendedCutoffAt: string;
  grantedByUserId: string;
  note: string | null;
  createdAt: string;
}
