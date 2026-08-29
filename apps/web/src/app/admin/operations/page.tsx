'use client';

import { Badge } from '@/components/ui/badge';
import { Card, PageHeader } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useFetch } from '@/hooks/use-fetch';
import { operationsApi } from '@/lib/endpoints';
import type { OperationalCount, ProviderConfigStatus } from '@/lib/types';

function ConfigBadge({ status }: { status: ProviderConfigStatus }) {
  return (
    <Badge tone={status === 'CONFIGURED' ? 'success' : 'warning'}>
      {status === 'CONFIGURED' ? 'Configured' : 'Not configured'}
    </Badge>
  );
}

/** `null` means the database was unreachable when this report was
 * generated — rendered as "Unavailable", never as a misleading `0`. */
function CountBadge({
  count,
  alertTone,
}: {
  count: OperationalCount;
  alertTone: 'danger' | 'warning';
}) {
  if (count === null) {
    return <Badge tone="neutral">Unavailable</Badge>;
  }
  return <Badge tone={count > 0 ? alertTone : 'neutral'}>{count}</Badge>;
}

/**
 * The compact launch operations view (Phase 5 section 17) — answers
 * "is the school operable right now," not a general analytics surface.
 * Never displays a credential value, only whether one is present.
 */
export default function AdminOperationsPage() {
  const report = useFetch(operationsApi.getReport);

  return (
    <div>
      <PageHeader
        title="Operations"
        description="Is the school operable right now — provider configuration and stuck operational counts, nothing more."
      />

      {report.isLoading && <LoadingState />}
      {report.error && <ErrorState message={report.error} onRetry={report.refetch} />}

      {report.data && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Platform</h2>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Database</span>
              <Badge tone={report.data.database === 'ok' ? 'success' : 'danger'}>
                {report.data.database === 'ok' ? 'Online' : 'Down'}
              </Badge>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold">Providers</h2>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Zoom (live classes)</span>
                <ConfigBadge status={report.data.providers.zoom} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Payments (Paystack)</span>
                <ConfigBadge status={report.data.providers.payments} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Email (SMTP)</span>
                <ConfigBadge status={report.data.providers.email} />
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold">Needs attention</h2>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Stuck meeting provisioning</span>
                <CountBadge count={report.data.stuckMeetingsCount} alertTone="danger" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Permanently failed notifications</span>
                <CountBadge
                  count={report.data.permanentlyFailedNotificationsCount}
                  alertTone="danger"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Payments awaiting resolution</span>
                <CountBadge
                  count={report.data.paymentsAwaitingResolutionCount}
                  alertTone="warning"
                />
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold">Upcoming</h2>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Scheduled sessions</span>
              <CountBadge count={report.data.upcomingSessionsCount} alertTone="warning" />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
