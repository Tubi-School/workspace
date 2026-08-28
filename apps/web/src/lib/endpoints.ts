import { api } from './api-client';
import type {
  AcademicTerm,
  AttendanceRecord,
  AttendanceRecordWithLearner,
  AttendanceWindowException,
  CompletionMode,
  CourseWithRelations,
  CoverageSummary,
  ExceptionReason,
  GradeLevel,
  LearnerVisibleSession,
  LearnerWithUser,
  Offering,
  PaymentOrder,
  SanitizedUser,
  SessionRecording,
  SessionWithRelations,
  SubscriptionAccess,
  SubscriptionStatus,
  Subject,
  TeacherRole,
  TeacherWithUser,
} from './types';

// ---------------------------------------------------------------------------
// Auth — apps/api/src/auth/auth.controller.ts
// ---------------------------------------------------------------------------

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ accessToken: string; user: SanitizedUser }>(
      '/auth/login',
      { email, password },
      { skipAuth: true },
    ),
  register: (email: string, password: string, fullName: string) =>
    api.post<SanitizedUser>('/auth/register', { email, password, fullName }, { skipAuth: true }),
  me: () => api.get<SanitizedUser>('/auth/me'),
};

// ---------------------------------------------------------------------------
// Curriculum catalog — grade-levels / subjects / academic-terms / courses
// ---------------------------------------------------------------------------

export const gradeLevelsApi = {
  list: () => api.get<GradeLevel[]>('/admin/grade-levels'),
  create: (name: string) => api.post<GradeLevel>('/admin/grade-levels', { name }),
  update: (id: string, name: string) =>
    api.patch<GradeLevel>(`/admin/grade-levels/${id}`, { name }),
  remove: (id: string) => api.delete<void>(`/admin/grade-levels/${id}`),
};

export const subjectsApi = {
  list: () => api.get<Subject[]>('/admin/subjects'),
  create: (name: string) => api.post<Subject>('/admin/subjects', { name }),
  update: (id: string, name: string) => api.patch<Subject>(`/admin/subjects/${id}`, { name }),
  remove: (id: string) => api.delete<void>(`/admin/subjects/${id}`),
};

export const academicTermsApi = {
  list: () => api.get<AcademicTerm[]>('/admin/academic-terms'),
  create: (dto: { name: string; startDate: string; endDate: string; timezone?: string }) =>
    api.post<AcademicTerm>('/admin/academic-terms', dto),
  update: (id: string, dto: Partial<{ name: string; startDate: string; endDate: string }>) =>
    api.patch<AcademicTerm>(`/admin/academic-terms/${id}`, dto),
  remove: (id: string) => api.delete<void>(`/admin/academic-terms/${id}`),
};

export const coursesApi = {
  list: () => api.get<CourseWithRelations[]>('/admin/courses'),
  get: (id: string) => api.get<CourseWithRelations>(`/admin/courses/${id}`),
  create: (dto: {
    subjectId: string;
    gradeLevelId: string;
    academicTermId: string;
    primaryTeacherId: string;
    title: string;
  }) => api.post<CourseWithRelations>('/admin/courses', dto),
  update: (id: string, dto: Partial<CourseWithRelations>) =>
    api.patch<CourseWithRelations>(`/admin/courses/${id}`, dto),
  remove: (id: string) => api.delete<void>(`/admin/courses/${id}`),
};

// ---------------------------------------------------------------------------
// People — teachers / learners
// ---------------------------------------------------------------------------

export const teachersApi = {
  list: () => api.get<TeacherWithUser[]>('/admin/teachers'),
  get: (id: string) => api.get<TeacherWithUser>(`/admin/teachers/${id}`),
  create: (dto: { email: string; password: string; fullName: string; bio?: string }) =>
    api.post<TeacherWithUser>('/admin/teachers', dto),
  update: (id: string, dto: Partial<{ fullName: string; bio: string; isActive: boolean }>) =>
    api.patch<TeacherWithUser>(`/admin/teachers/${id}`, dto),
};

export const learnersApi = {
  list: () => api.get<LearnerWithUser[]>('/admin/learners'),
  get: (id: string) => api.get<LearnerWithUser>(`/admin/learners/${id}`),
  update: (id: string, dto: Partial<{ fullName: string; isActive: boolean }>) =>
    api.patch<LearnerWithUser>(`/admin/learners/${id}`, dto),
};

// ---------------------------------------------------------------------------
// Sessions — admin/teacher-visible surface (apps/api/src/sessions)
// ---------------------------------------------------------------------------

export const sessionsApi = {
  list: () => api.get<SessionWithRelations[]>('/admin/sessions'),
  get: (id: string) => api.get<SessionWithRelations>(`/admin/sessions/${id}`),
  create: (dto: {
    courseId: string;
    sessionDate: string;
    startTime: string;
    endTime: string;
    /** Optional as of Phase 4 — leave unset to let MeetingProvisioningService
     * create the Zoom meeting automatically. Only supply this as a manual
     * fallback. */
    liveMeetingUrl?: string;
    replacementForSessionId?: string;
    assistantTeacherIds?: string[];
    substituteTeacherIds?: string[];
  }) => api.post<SessionWithRelations>('/admin/sessions', dto),
  update: (
    id: string,
    dto: Partial<{
      courseId: string;
      sessionDate: string;
      startTime: string;
      endTime: string;
      liveMeetingUrl: string;
    }>,
  ) => api.patch<SessionWithRelations>(`/admin/sessions/${id}`, dto),
  markLive: (id: string) => api.post<SessionWithRelations>(`/admin/sessions/${id}/mark-live`),
  markEnded: (id: string) => api.post<SessionWithRelations>(`/admin/sessions/${id}/mark-ended`),
  cancel: (id: string) => api.post<SessionWithRelations>(`/admin/sessions/${id}/cancel`),
  addTeacher: (id: string, teacherId: string, role: TeacherRole) =>
    api.post<SessionWithRelations>(`/admin/sessions/${id}/teachers`, { teacherId, role }),
  updateTeacherRole: (id: string, teacherId: string, role: TeacherRole) =>
    api.patch<SessionWithRelations>(`/admin/sessions/${id}/teachers/${teacherId}`, { role }),
  removeTeacher: (id: string, teacherId: string) =>
    api.delete<SessionWithRelations>(`/admin/sessions/${id}/teachers/${teacherId}`),
  reassignPrimaryTeacher: (
    id: string,
    incomingTeacherId: string,
    outgoingTeacherAction: 'BECOME_ASSISTANT' | 'BECOME_SUBSTITUTE' | 'REMOVE',
  ) =>
    api.patch<SessionWithRelations>(`/admin/sessions/${id}/primary-teacher`, {
      incomingTeacherId,
      outgoingTeacherAction,
    }),
  /** Manual retry for a session whose automatic Zoom provisioning failed
   * (section E — launch-console reconciliation action). */
  provisionMeeting: (id: string) =>
    api.post<SessionWithRelations>(`/admin/sessions/${id}/provision-meeting`),
};

// ---------------------------------------------------------------------------
// Teacher self-service (apps/api/src/teacher-portal) — Phase 3 external
// review Correction 1: server-side teacher scoping. Identity is always
// derived from the authenticated JWT on the backend; these calls never
// send a teacherId.
// ---------------------------------------------------------------------------

export const teacherPortalApi = {
  me: () => api.get<TeacherWithUser>('/teacher/me'),
  listCourses: () => api.get<CourseWithRelations[]>('/teacher/courses'),
  listSessions: () => api.get<SessionWithRelations[]>('/teacher/sessions'),
  getSession: (id: string) => api.get<SessionWithRelations>(`/teacher/sessions/${id}`),
};

// ---------------------------------------------------------------------------
// Offerings (apps/api/src/offerings) — Phase 3 external review Correction
// 3: read-only ADMIN catalog used to populate the Subscription Access
// grant form.
// ---------------------------------------------------------------------------

export const offeringsApi = {
  list: () => api.get<Offering[]>('/admin/offerings'),
};

// ---------------------------------------------------------------------------
// Subscription access grants (apps/api/src/subscription-access)
// ---------------------------------------------------------------------------

export const subscriptionAccessApi = {
  list: () => api.get<SubscriptionAccess[]>('/admin/subscription-access'),
  create: (dto: {
    learnerId: string;
    offeringId: string;
    status?: SubscriptionStatus;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  }) => api.post<SubscriptionAccess>('/admin/subscription-access', dto),
  update: (
    id: string,
    dto: Partial<{
      status: SubscriptionStatus;
      currentPeriodStart: string;
      currentPeriodEnd: string;
    }>,
  ) => api.patch<SubscriptionAccess>(`/admin/subscription-access/${id}`, dto),
  revoke: (id: string) => api.post<SubscriptionAccess>(`/admin/subscription-access/${id}/revoke`),
};

// ---------------------------------------------------------------------------
// Attendance — admin/teacher reads, override, finalize, recording,
// window exceptions (apps/api/src/attendance)
// ---------------------------------------------------------------------------

export const attendanceApi = {
  getForSessionAsAdmin: (sessionId: string) =>
    api.get<AttendanceRecordWithLearner[]>(`/admin/attendance/sessions/${sessionId}`),
  getForSessionAsTeacher: (sessionId: string) =>
    api.get<AttendanceRecordWithLearner[]>(`/teacher/attendance/sessions/${sessionId}`),
  getLearnerHistory: (learnerId: string) =>
    api.get<AttendanceRecord[]>(`/admin/attendance/learners/${learnerId}`),
  getCoverage: (sessionId: string, learnerId: string) =>
    api.get<CoverageSummary>(
      `/admin/attendance/sessions/${sessionId}/learners/${learnerId}/coverage`,
    ),
  override: (
    attendanceRecordId: string,
    dto: {
      newStatus: 'PENDING' | 'PRESENT' | 'ABSENT';
      completionMode?: CompletionMode;
      completedAt?: string;
      reason: string;
    },
  ) => api.post<AttendanceRecord>(`/admin/attendance/${attendanceRecordId}/override`, dto),
  finalize: () => api.post<{ finalizedCount: number }>('/admin/attendance/finalize'),
  publishRecording: (
    sessionId: string,
    dto: { recordingUrl: string; availableFrom?: string; totalSeconds: number },
  ) => api.post<SessionRecording>(`/admin/sessions/${sessionId}/recording`, dto),
  listWindowExceptions: (sessionId: string) =>
    api.get<AttendanceWindowException[]>(`/admin/sessions/${sessionId}/window-exceptions`),
  createWindowException: (
    sessionId: string,
    dto: { learnerId?: string; reason: ExceptionReason; extendedCutoffAt: string; note?: string },
  ) => api.post<AttendanceWindowException>(`/admin/sessions/${sessionId}/window-exceptions`, dto),
};

// ---------------------------------------------------------------------------
// Learner self-service (apps/api/src/learner-portal)
// ---------------------------------------------------------------------------

export const learnerPortalApi = {
  listSessions: () => api.get<LearnerVisibleSession[]>('/learner/sessions'),
  getSession: (id: string) => api.get<LearnerVisibleSession>(`/learner/sessions/${id}`),
  getAttendance: (id: string) =>
    api.get<AttendanceRecord & CoverageSummary>(`/learner/sessions/${id}/attendance`),
  reportWatchedInterval: (
    sessionId: string,
    startSecond: number,
    endSecond: number,
    options?: { keepalive?: boolean },
  ) =>
    api.post<void>(
      `/learner/sessions/${sessionId}/recording/watched-intervals`,
      { startSecond, endSecond },
      options,
    ),
};

// ---------------------------------------------------------------------------
// Commercial layer (apps/api/src/payments) — Phase 4
// ---------------------------------------------------------------------------

export const paymentsApi = {
  /** Learner-facing commercial discovery — what's available to subscribe
   * to, before any SubscriptionAccess exists. */
  listOfferings: () => api.get<Offering[]>('/learner/offerings'),
  checkout: (offeringId: string) =>
    api.post<{ checkoutUrl: string }>('/learner/payments/checkout', { offeringId }),
  listAll: () => api.get<PaymentOrder[]>('/admin/payments'),
};
