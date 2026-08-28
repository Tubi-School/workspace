'use client';

import Link from 'next/link';
import { useState } from 'react';

import { SessionStatusBadge } from '@/components/session-status-badge';
import { Badge } from '@/components/ui/badge';
import { Card, PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useAuth } from '@/context/auth-context';
import { useFetch } from '@/hooks/use-fetch';
import { teacherPortalApi } from '@/lib/endpoints';

/**
 * Phase 3 external review Correction 1: this page now reads
 * `/teacher/courses` and `/teacher/sessions` (apps/api/src/teacher-portal),
 * which the backend itself scopes to the caller's own TeacherProfile,
 * resolved from the JWT — never a broad ADMIN collection filtered in the
 * browser. Client-side filtering was never an authorization boundary;
 * server-side scoping is.
 */
export default function TeacherOverviewPage() {
  const { user } = useAuth();
  const courses = useFetch(teacherPortalApi.listCourses);
  const sessions = useFetch(teacherPortalApi.listSessions);
  // Captured once, at mount, via a lazy initializer rather than a bare
  // `Date.now()` call in the render body — "upcoming" is inherently a
  // wall-clock comparison, but it only needs to reflect the moment this
  // page was opened, not recompute on every render.
  const [referenceTime] = useState(() => Date.now());

  if (courses.isLoading || sessions.isLoading) return <LoadingState />;
  if (courses.error) return <ErrorState message={courses.error} onRetry={courses.refetch} />;
  if (sessions.error) return <ErrorState message={sessions.error} onRetry={sessions.refetch} />;

  const myCourses = courses.data ?? [];
  const mySessions = (sessions.data ?? [])
    .filter((s) => new Date(s.startTime).getTime() >= referenceTime || s.status === 'LIVE')
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.fullName ?? ''}`}
        description="Your assigned courses and upcoming sessions."
      />

      <div className="mb-8">
        <h2 className="text-foreground mb-3 text-sm font-semibold">Assigned courses</h2>
        {myCourses.length === 0 ? (
          <EmptyState title="No courses assigned to you yet" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {myCourses.map((course) => (
              <Card key={course.id}>
                <p className="text-foreground text-sm font-medium">{course.title}</p>
                <p className="text-muted-foreground text-sm">
                  {course.subject.name} · {course.gradeLevel.name}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-foreground mb-3 text-sm font-semibold">Upcoming sessions</h2>
        {mySessions.length === 0 ? (
          <EmptyState title="No upcoming sessions" />
        ) : (
          <ul className="flex flex-col gap-2">
            {mySessions.map((session) => {
              const myRole = session.teachers.find(
                (t) => t.teacher.user.id === user?.id,
              )?.teacherRole;
              return (
                <li key={session.id}>
                  <Link
                    href={`/teacher/sessions/${session.id}`}
                    className="border-border bg-surface-raised hover:bg-surface-hover flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors"
                  >
                    <div>
                      <p className="text-foreground text-sm font-medium">{session.course.title}</p>
                      <p className="text-muted-foreground text-sm">
                        {new Date(session.startTime).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {myRole && <Badge tone="neutral">{myRole}</Badge>}
                      <SessionStatusBadge status={session.status} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
