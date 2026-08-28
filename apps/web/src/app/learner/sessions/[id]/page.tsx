'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@tubi/ui';
import { AttendanceStatusBadge } from '@/components/attendance-status-badge';
import { SessionStatusBadge } from '@/components/session-status-badge';
import { Card, PageHeader } from '@/components/ui/card';
import { Field, TextInput } from '@/components/ui/form';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useAsyncAction } from '@/hooks/use-async-action';
import { useFetch } from '@/hooks/use-fetch';
import { learnerPortalApi } from '@/lib/endpoints';

/**
 * DeliveryMode enforcement here is purely presentational: the backend has
 * already decided what this learner may see. `session.liveMeetingUrl` is
 * an empty string whenever this learner's entitlement does not
 * affirmatively resolve to LIVE_AND_RECORDED (see
 * apps/api/src/learner-portal/learner-portal.service.ts's redactLiveAccess,
 * Phase 2G Correction 3) — this page shows the "Join live class" section
 * if and only if that field is non-empty, and never tries to infer or
 * override that decision. Recording access is identical: the `recording`
 * relation is simply absent (`null`) until an ADMIN publishes one, and
 * both DeliveryMode values include recorded access, so there is no
 * recorded-side redaction to reproduce.
 */
export default function LearnerSessionDetailPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const session = useFetch(() => learnerPortalApi.getSession(sessionId), [sessionId]);
  const attendance = useFetch(() => learnerPortalApi.getAttendance(sessionId), [sessionId]);

  const [startSecond, setStartSecond] = useState('');
  const [endSecond, setEndSecond] = useState('');
  const reportAction = useAsyncAction(async () => {
    await learnerPortalApi.reportWatchedInterval(sessionId, Number(startSecond), Number(endSecond));
    setStartSecond('');
    setEndSecond('');
    attendance.refetch();
  });

  if (session.isLoading) return <LoadingState />;
  if (session.error) return <ErrorState message={session.error} />;
  if (!session.data) return null;

  const s = session.data;
  const hasLiveAccess = s.liveMeetingUrl.length > 0;

  function handleReport(event: FormEvent) {
    event.preventDefault();
    if (startSecond === '' || endSecond === '') return;
    void reportAction.run();
  }

  return (
    <div>
      <PageHeader
        title={s.course.title}
        description={new Date(s.startTime).toLocaleString()}
        actions={<SessionStatusBadge status={s.status} />}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Live class</h2>
          {hasLiveAccess ? (
            <>
              <p className="text-muted-foreground mb-3 text-sm">
                Live participation is included in your plan for this class.
              </p>
              <a
                href={s.liveMeetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block"
              >
                <Button size="sm">Join live class</Button>
              </a>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Live participation is not included in your current plan for this class.
            </p>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold">Recording</h2>
          {s.recording ? (
            <>
              <p className="text-muted-foreground mb-3 text-sm">
                Available since {new Date(s.recording.availableFrom).toLocaleString()}.
              </p>
              <a
                href={s.recording.recordingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block"
              >
                <Button size="sm" variant="secondary">
                  Open recording
                </Button>
              </a>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              No recording has been published for this class yet.
            </p>
          )}
        </Card>
      </div>

      {s.recording && (
        <Card className="mb-6">
          <h2 className="mb-1 text-sm font-semibold">Report viewing progress</h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Playback tracking is not yet built into a video player — this reports the range you
            watched directly to the same coverage engine a future player will call automatically.
            Total length: {Math.round(s.recording.totalSeconds / 60)} minutes.
          </p>
          <form onSubmit={handleReport} className="flex flex-wrap items-end gap-3">
            <Field label="From (seconds)">
              <TextInput
                type="number"
                min={0}
                value={startSecond}
                onChange={(e) => setStartSecond(e.target.value)}
                disabled={reportAction.isSubmitting}
                className="w-32"
              />
            </Field>
            <Field label="To (seconds)">
              <TextInput
                type="number"
                min={0}
                value={endSecond}
                onChange={(e) => setEndSecond(e.target.value)}
                disabled={reportAction.isSubmitting}
                className="w-32"
              />
            </Field>
            <Button type="submit" size="sm" disabled={reportAction.isSubmitting}>
              {reportAction.isSubmitting ? 'Reporting…' : 'Report'}
            </Button>
          </form>
          {reportAction.error && <p className="text-danger mt-2 text-sm">{reportAction.error}</p>}
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Attendance</h2>
        {attendance.isLoading && <LoadingState />}
        {attendance.error && <ErrorState message={attendance.error} onRetry={attendance.refetch} />}
        {attendance.data && (
          <div className="flex flex-col gap-3">
            <AttendanceStatusBadge
              status={attendance.data.status}
              completionMode={attendance.data.completionMode}
            />
            <div className="text-muted-foreground flex flex-col gap-1 text-sm">
              <span>
                Live participation: {Math.round(attendance.data.liveCoverageMs / 60000)} minute(s)
              </span>
              {attendance.data.recordedCoverageSeconds !== null && (
                <span>
                  Recording watched: {Math.round(attendance.data.recordedCoverageSeconds / 60)}{' '}
                  minute(s)
                </span>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
