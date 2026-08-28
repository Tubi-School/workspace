'use client';

import { useParams } from 'next/navigation';

import { Button } from '@tubi/ui';
import { AttendanceStatusBadge } from '@/components/attendance-status-badge';
import { RecordingPlayer } from '@/components/recording-player';
import { SessionStatusBadge } from '@/components/session-status-badge';
import { Card, PageHeader } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
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

  if (session.isLoading) return <LoadingState />;
  if (session.error) return <ErrorState message={session.error} />;
  if (!session.data) return null;

  const s = session.data;
  const hasLiveAccess = s.liveMeetingUrl.length > 0;
  // A Zoom-ingested recording's `recordingUrl` is Zoom's own hosted
  // playback page — it cannot report progress back into TUBI, so it is
  // opened externally rather than embedded. A recording with no
  // `provider` was manually published as a direct, playable file, and
  // gets the real player with automatic watched-interval reporting.
  const canEmbedPlayer = s.recording !== null && s.recording.provider === null;

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
              {canEmbedPlayer ? (
                <p className="text-muted-foreground text-sm">Watch below.</p>
              ) : (
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
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              No recording has been published for this class yet.
            </p>
          )}
        </Card>
      </div>

      {s.recording && canEmbedPlayer && (
        <Card className="mb-6">
          <h2 className="mb-3 text-sm font-semibold">Watch recording</h2>
          <RecordingPlayer
            sessionId={sessionId}
            recordingUrl={s.recording.recordingUrl}
            onProgressReported={attendance.refetch}
          />
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
