'use client';

import Link from 'next/link';

import { SessionStatusBadge } from '@/components/session-status-badge';
import { PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useFetch } from '@/hooks/use-fetch';
import { teacherPortalApi } from '@/lib/endpoints';

/**
 * Phase 3 external review Correction 1: reads the server-scoped
 * `/teacher/sessions` endpoint — the backend itself returns only sessions
 * this caller's TeacherProfile is assigned to, resolved from the JWT.
 */
export default function TeacherSessionsPage() {
  const sessions = useFetch(teacherPortalApi.listSessions);

  if (sessions.isLoading) return <LoadingState />;
  if (sessions.error) return <ErrorState message={sessions.error} onRetry={sessions.refetch} />;

  const mySessions = [...(sessions.data ?? [])].sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
  );

  return (
    <div>
      <PageHeader title="My Sessions" description="Every session you are assigned to teach." />
      {mySessions.length === 0 ? (
        <EmptyState title="You have not been assigned to any sessions yet" />
      ) : (
        <ul className="flex flex-col gap-2">
          {mySessions.map((session) => (
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
                <SessionStatusBadge status={session.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
