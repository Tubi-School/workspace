'use client';

import Link from 'next/link';
import { useState } from 'react';

import { SessionStatusBadge } from '@/components/session-status-badge';
import { PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useFetch } from '@/hooks/use-fetch';
import { learnerPortalApi } from '@/lib/endpoints';

export default function LearnerSessionsPage() {
  const { data, isLoading, error, refetch } = useFetch(learnerPortalApi.listSessions);
  // See teacher/page.tsx for why this is a lazy useState initializer rather
  // than a bare Date.now() call in the render body.
  const [referenceTime] = useState(() => Date.now());

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const sessions = [...(data ?? [])].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );
  const next = sessions.find(
    (s) => new Date(s.startTime).getTime() >= referenceTime && s.status !== 'CANCELED',
  );

  if (sessions.length === 0) {
    return (
      <div>
        <PageHeader
          title="My Sessions"
          description="Your classes will appear here once you're enrolled."
        />
        <EmptyState
          title="No classes yet"
          description="Once you're granted access to a subscription, your sessions will show up here."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="My Sessions" description="Your classes — live and recorded." />

      {next && (
        <div className="border-brand/30 bg-brand/5 mb-6 rounded-xl border p-5">
          <p className="text-brand mb-1 text-xs font-semibold tracking-wide uppercase">
            Next class
          </p>
          <p className="text-foreground text-lg font-semibold">{next.course.title}</p>
          <p className="text-muted-foreground text-sm">
            {new Date(next.startTime).toLocaleString()}
          </p>
          <Link
            href={`/learner/sessions/${next.id}`}
            className="text-brand mt-2 inline-block text-sm font-medium underline"
          >
            View details
          </Link>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {sessions.map((session) => (
          <li key={session.id}>
            <Link
              href={`/learner/sessions/${session.id}`}
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
    </div>
  );
}
