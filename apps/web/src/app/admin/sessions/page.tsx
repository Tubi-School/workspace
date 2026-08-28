'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@tubi/ui';
import { Card, PageHeader } from '@/components/ui/card';
import { Field, Select, TextInput } from '@/components/ui/form';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { SessionStatusBadge } from '@/components/session-status-badge';
import { useAsyncAction } from '@/hooks/use-async-action';
import { useFetch } from '@/hooks/use-fetch';
import { coursesApi, sessionsApi } from '@/lib/endpoints';

export default function SessionsPage() {
  const sessions = useFetch(sessionsApi.list);
  const courses = useFetch(coursesApi.list);

  const [courseId, setCourseId] = useState('');
  const [sessionDate, setSessionDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [liveMeetingUrl, setLiveMeetingUrl] = useState('');

  const createAction = useAsyncAction(async () => {
    await sessionsApi.create({
      courseId,
      sessionDate,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      // Leave unset unless an ADMIN explicitly overrides it — automatic
      // Zoom meeting provisioning fills this in (section E).
      ...(liveMeetingUrl.trim() ? { liveMeetingUrl: liveMeetingUrl.trim() } : {}),
    });
    setCourseId('');
    setSessionDate('');
    setStartTime('');
    setEndTime('');
    setLiveMeetingUrl('');
    sessions.refetch();
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!courseId || !sessionDate || !startTime || !endTime) return;
    void createAction.run();
  }

  const sortedSessions = sessions.data
    ? [...sessions.data].sort(
        (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
      )
    : null;

  return (
    <div>
      <PageHeader
        title="Sessions"
        description="The atomic teaching event — schedule and manage lessons."
      />

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">Schedule a session</h2>

        {courses.isLoading && <LoadingState />}
        {courses.error && <ErrorState message={courses.error} onRetry={courses.refetch} />}
        {courses.data && courses.data.length === 0 && (
          <EmptyState title="Add a course first" description="A session must belong to a course." />
        )}

        {courses.data && courses.data.length > 0 && (
          <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
            <Field label="Course">
              <Select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                disabled={createAction.isSubmitting}
              >
                <option value="">Select a course</option>
                {courses.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Session date">
              <TextInput
                type="date"
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                disabled={createAction.isSubmitting}
              />
            </Field>
            <Field label="Start time">
              <TextInput
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={createAction.isSubmitting}
              />
            </Field>
            <Field label="End time">
              <TextInput
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={createAction.isSubmitting}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Live meeting URL (optional — leave blank to auto-provision via Zoom)">
                <TextInput
                  type="url"
                  value={liveMeetingUrl}
                  onChange={(e) => setLiveMeetingUrl(e.target.value)}
                  disabled={createAction.isSubmitting}
                  placeholder="Leave blank for automatic provisioning"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={createAction.isSubmitting}>
                {createAction.isSubmitting ? 'Scheduling…' : 'Schedule session'}
              </Button>
            </div>
          </form>
        )}
        {createAction.error && <p className="text-danger mt-2 text-sm">{createAction.error}</p>}
      </Card>

      {sessions.isLoading && <LoadingState />}
      {sessions.error && <ErrorState message={sessions.error} onRetry={sessions.refetch} />}
      {sortedSessions && sortedSessions.length === 0 && (
        <EmptyState title="No sessions scheduled yet" />
      )}
      {sortedSessions && sortedSessions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {sortedSessions.map((session) => (
            <li key={session.id}>
              <Link
                href={`/admin/sessions/${session.id}`}
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
