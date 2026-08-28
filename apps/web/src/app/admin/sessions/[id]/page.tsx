'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@tubi/ui';
import { AttendanceStatusBadge } from '@/components/attendance-status-badge';
import { SessionStatusBadge } from '@/components/session-status-badge';
import { Badge } from '@/components/ui/badge';
import { Card, PageHeader } from '@/components/ui/card';
import { Field, Select, TextInput } from '@/components/ui/form';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useAsyncAction } from '@/hooks/use-async-action';
import { useFetch } from '@/hooks/use-fetch';
import { attendanceApi, sessionsApi, teachersApi } from '@/lib/endpoints';
import type { TeacherRole } from '@/lib/types';

export default function AdminSessionDetailPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const session = useFetch(() => sessionsApi.get(sessionId), [sessionId]);
  const attendance = useFetch(() => attendanceApi.getForSessionAsAdmin(sessionId), [sessionId]);
  const teachers = useFetch(teachersApi.list);

  const lifecycleAction = useAsyncAction(async (action: 'markLive' | 'markEnded' | 'cancel') => {
    await sessionsApi[action](sessionId);
    session.refetch();
  });

  const provisionAction = useAsyncAction(async () => {
    await sessionsApi.provisionMeeting(sessionId);
    session.refetch();
  });

  const [teacherId, setTeacherId] = useState('');
  const [role, setRole] = useState<TeacherRole>('ASSISTANT');
  const assignAction = useAsyncAction(async () => {
    await sessionsApi.addTeacher(sessionId, teacherId, role);
    setTeacherId('');
    session.refetch();
  });
  const removeAction = useAsyncAction(async (removeTeacherId: string) => {
    await sessionsApi.removeTeacher(sessionId, removeTeacherId);
    session.refetch();
  });

  const [recordingUrl, setRecordingUrl] = useState('');
  const [totalSeconds, setTotalSeconds] = useState('');
  const publishAction = useAsyncAction(async () => {
    await attendanceApi.publishRecording(sessionId, {
      recordingUrl: recordingUrl.trim(),
      totalSeconds: Number(totalSeconds),
    });
    setRecordingUrl('');
    setTotalSeconds('');
  });

  if (session.isLoading) return <LoadingState />;
  if (session.error) return <ErrorState message={session.error} onRetry={session.refetch} />;
  if (!session.data) return null;

  const s = session.data;

  function handleAssign(event: FormEvent) {
    event.preventDefault();
    if (!teacherId) return;
    void assignAction.run();
  }

  function handlePublish(event: FormEvent) {
    event.preventDefault();
    if (!recordingUrl.trim() || !totalSeconds) return;
    void publishAction.run();
  }

  return (
    <div>
      <PageHeader
        title={s.course.title}
        description={new Date(s.startTime).toLocaleString()}
        actions={<SessionStatusBadge status={s.status} />}
      />

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">Lifecycle</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={s.status !== 'SCHEDULED' || lifecycleAction.isSubmitting}
            onClick={() => void lifecycleAction.run('markLive')}
          >
            Mark live
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={s.status !== 'LIVE' || lifecycleAction.isSubmitting}
            onClick={() => void lifecycleAction.run('markEnded')}
          >
            Mark ended
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={
              (s.status !== 'SCHEDULED' && s.status !== 'LIVE') || lifecycleAction.isSubmitting
            }
            onClick={() => void lifecycleAction.run('cancel')}
          >
            Cancel session
          </Button>
        </div>
        {s.replacementForSessionId && (
          <p className="text-muted-foreground mt-3 text-sm">
            This session is a replacement for a previously canceled session.
          </p>
        )}
        {lifecycleAction.error && (
          <p className="text-danger mt-2 text-sm">{lifecycleAction.error}</p>
        )}
      </Card>

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">Live classroom</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Badge
            tone={
              s.meetingProvisioningStatus === 'PROVISIONED'
                ? 'success'
                : s.meetingProvisioningStatus === 'FAILED'
                  ? 'danger'
                  : s.meetingProvisioningStatus === 'PENDING'
                    ? 'warning'
                    : 'neutral'
            }
          >
            {s.meetingProvisioningStatus}
          </Badge>
          {s.meetingProvider && (
            <span className="text-muted-foreground text-sm">via {s.meetingProvider}</span>
          )}
          {s.liveMeetingUrl && (
            <a
              href={s.liveMeetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground text-sm underline"
            >
              Open meeting
            </a>
          )}
          {s.meetingProvisioningStatus !== 'PROVISIONED' &&
            (s.status === 'SCHEDULED' || s.status === 'LIVE') && (
              <Button
                size="sm"
                variant="secondary"
                disabled={provisionAction.isSubmitting}
                onClick={() => void provisionAction.run()}
              >
                {provisionAction.isSubmitting ? 'Provisioning…' : 'Retry provisioning'}
              </Button>
            )}
        </div>
        {s.meetingProvisioningError && (
          <p className="text-danger mt-2 text-sm">{s.meetingProvisioningError}</p>
        )}
        {provisionAction.error && (
          <p className="text-danger mt-2 text-sm">{provisionAction.error}</p>
        )}
      </Card>

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">Teachers</h2>
        <ul className="mb-4 flex flex-col gap-2">
          {s.teachers.map((entry) => (
            <li key={entry.teacherId} className="flex items-center justify-between gap-3">
              <span className="text-sm">
                {entry.teacher.user.fullName} <Badge tone="neutral">{entry.teacherRole}</Badge>
              </span>
              {entry.teacherRole !== 'PRIMARY' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void removeAction.run(entry.teacherId)}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>

        {teachers.data && (
          <form onSubmit={handleAssign} className="flex flex-wrap items-end gap-2">
            <Field label="Add teacher">
              <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                <option value="">Select a teacher</option>
                {teachers.data.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.user.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Role">
              <Select value={role} onChange={(e) => setRole(e.target.value as TeacherRole)}>
                <option value="ASSISTANT">Assistant</option>
                <option value="SUBSTITUTE">Substitute</option>
              </Select>
            </Field>
            <Button type="submit" size="sm" disabled={assignAction.isSubmitting}>
              Assign
            </Button>
          </form>
        )}
        {assignAction.error && <p className="text-danger mt-2 text-sm">{assignAction.error}</p>}
        {removeAction.error && <p className="text-danger mt-2 text-sm">{removeAction.error}</p>}
      </Card>

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">Recording</h2>
        <p className="text-muted-foreground mb-3 text-sm">
          Publishing is only possible once the session has ended. This does not build a video player
          — it stores the recording URL and total duration the real coverage engine uses to compute
          attendance.
        </p>
        <form onSubmit={handlePublish} className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <div className="sm:col-span-2">
            <Field label="Recording URL">
              <TextInput
                type="url"
                value={recordingUrl}
                onChange={(e) => setRecordingUrl(e.target.value)}
                disabled={s.status !== 'ENDED' || publishAction.isSubmitting}
              />
            </Field>
          </div>
          <Field label="Total seconds">
            <TextInput
              type="number"
              min={1}
              value={totalSeconds}
              onChange={(e) => setTotalSeconds(e.target.value)}
              disabled={s.status !== 'ENDED' || publishAction.isSubmitting}
            />
          </Field>
          <div className="sm:col-span-3">
            <Button
              type="submit"
              size="sm"
              disabled={s.status !== 'ENDED' || publishAction.isSubmitting}
            >
              Publish recording
            </Button>
          </div>
        </form>
        {publishAction.error && <p className="text-danger mt-2 text-sm">{publishAction.error}</p>}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Attendance</h2>
        {attendance.isLoading && <LoadingState />}
        {attendance.error && <ErrorState message={attendance.error} onRetry={attendance.refetch} />}
        {attendance.data && attendance.data.length === 0 && (
          <EmptyState
            title="No entitled learners yet"
            description="Attendance appears once learners are entitled to this session."
          />
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
