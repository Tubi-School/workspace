'use client';

import Link from 'next/link';

import { Card, PageHeader } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useAuth } from '@/context/auth-context';
import { useFetch } from '@/hooks/use-fetch';
import { coursesApi, learnersApi, sessionsApi, teachersApi } from '@/lib/endpoints';

async function fetchOverviewCounts() {
  const [courses, teachers, learners, sessions] = await Promise.all([
    coursesApi.list(),
    teachersApi.list(),
    learnersApi.list(),
    sessionsApi.list(),
  ]);
  return {
    courses: courses.length,
    teachers: teachers.length,
    learners: learners.length,
    upcomingSessions: sessions.filter((s) => s.status === 'SCHEDULED' || s.status === 'LIVE')
      .length,
  };
}

const TILES = [
  { key: 'courses' as const, label: 'Courses', href: '/admin/courses' },
  { key: 'teachers' as const, label: 'Teachers', href: '/admin/teachers' },
  { key: 'learners' as const, label: 'Learners', href: '/admin/learners' },
  { key: 'upcomingSessions' as const, label: 'Upcoming sessions', href: '/admin/sessions' },
];

export default function AdminOverviewPage() {
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useFetch(fetchOverviewCounts);

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.fullName ?? ''}`}
        description="Your school at a glance."
      />

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TILES.map((tile) => (
            <Link key={tile.key} href={tile.href}>
              <Card className="hover:bg-surface-hover transition-colors">
                <p className="text-muted-foreground text-sm">{tile.label}</p>
                <p className="text-foreground mt-1 text-3xl font-semibold">{data[tile.key]}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
