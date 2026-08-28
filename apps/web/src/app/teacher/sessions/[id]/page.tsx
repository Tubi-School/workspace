'use client';

import { useParams } from 'next/navigation';

import { AttendanceStatusBadge } from '@/components/attendance-status-badge';
import { SessionStatusBadge } from '@/components/session-status-badge';
import { Badge } from '@/components/ui/badge';
import { Card, PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useFetch } from '@/hooks/use-fetch';
import { attendanceApi, teacherPortalApi } from '@/lib/endpoints';

/**
 * Read-only by design: the backend currently authorizes session lifecycle
 * transitions (mark-live/mark-ended/cancel) and recording publication to
 * ADMIN only (see apps/api/src/sessions/sessions.controller.ts and
 * apps/api/src/attendance/attendance-admin.controller.ts) — there is no
 * TEACHER-authorized mutation for either. This page never fabricates
 * buttons for capabilities the backend does not grant a teacher.
 *
 * Phase 3 external review Correction 1: reads `/teacher/sessions/:id`
 * (apps/api/src/teacher-portal), which the backend scopes to sessions
 * this caller is actually assigned to — a session this teacher is not
 * assigned to reads as 404 here, not the unscoped `/admin/sessions/:id`
 * any TEACHER role could previously read regardless of assignment.
 */
export default function TeacherSessionDetailPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const session = useFetch(() => teacherPortalApi.getSession(sessionId), [sessionId]);
  const attendance = useFetch(() => attendanceApi.getForSessionAsTeacher(sessionId), [sessionId]);

  if (session.isLoading) return <LoadingState />;
  if (session.error) return <ErrorState message={session.error} onRetry={session.refetch} />;
  if (!session.data) return null;

  const s = session.data;

  return (
    <div>
      <PageHeader
        title={s.course.title}
        description={new Date(s.startTime).toLocaleString()}
        actions={<SessionStatusBadge status={s.status} />}
      />

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">Teaching team</h2>
        <ul className="flex flex-col gap-2">
          {s.teachers.map((entry) => (
            <li key={entry.teacherId} className="text-sm">
              {entry.teacher.user.fullName} <Badge tone="neutral">{entry.teacherRole}</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Attendance</h2>
        {attendance.isLoading && <LoadingState />}
        {attendance.error && <ErrorState message={attendance.error} onRetry={attendance.refetch} />}
        {attendance.data && attendance.data.length === 0 && (
          <EmptyState title="No entitled learners yet" />
        )}
        {attendance.data && attendance.data.length > 0 && (
          <ul className="flex flex-col gap-2">
            {attendance.data.map((record) => (
              <li key={record.id} className="flex items-center justify-between gap-3">
                <span className="text-sm">{record.learner.user.fullName}</span>
                <AttendanceStatusBadge
                  status={record.status}
                  completionMode={record.completionMode}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
