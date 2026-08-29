'use client';

import { useState } from 'react';

import { Button } from '@tubi/ui';
import { Badge } from '@/components/ui/badge';
import { Card, PageHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useAsyncAction } from '@/hooks/use-async-action';
import { useFetch } from '@/hooks/use-fetch';
import { notificationsApi } from '@/lib/endpoints';
import type { NotificationOutboxStatus } from '@/lib/types';

const STATUS_TONE: Record<NotificationOutboxStatus, 'neutral' | 'success' | 'warning' | 'danger'> =
  {
    PENDING: 'neutral',
    SENDING: 'warning',
    SENT: 'success',
    FAILED: 'danger',
  };

/**
 * Minimum ADMIN visibility into the notification outbox (Phase 5 section
 * 15) — never a marketing/campaign surface. Retry only ever moves a
 * permanently-FAILED row back to PENDING for the existing fenced dispatcher
 * to pick up; this page never sends an email itself and never claims
 * exactly-once delivery.
 */
export default function AdminNotificationsPage() {
  const [statusFilter, setStatusFilter] = useState<NotificationOutboxStatus | ''>('');
  const notifications = useFetch(
    () => notificationsApi.list(statusFilter || undefined),
    [statusFilter],
  );

  const retryAction = useAsyncAction(async (id: string) => {
    await notificationsApi.retry(id);
    notifications.refetch();
  });

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Delivery status for account, payment, session, and recording emails. At-least-once delivery — never exactly-once."
      />

      <Card className="mb-4">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as NotificationOutboxStatus | '')}
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="SENDING">Sending</option>
          <option value="SENT">Sent</option>
          <option value="FAILED">Failed</option>
        </Select>
      </Card>

      {notifications.isLoading && <LoadingState />}
      {notifications.error && (
        <ErrorState message={notifications.error} onRetry={notifications.refetch} />
      )}
      {notifications.data && notifications.data.length === 0 && (
        <EmptyState title="No notifications match this filter" />
      )}
      {retryAction.error && <p className="text-danger mb-2 text-sm">{retryAction.error}</p>}

      {notifications.data && notifications.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {notifications.data.map((item) => (
            <li
              key={item.id}
              className="border-border bg-surface-raised flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
            >
              <div>
                <p className="text-foreground text-sm font-medium">
                  {item.type} — {item.recipient?.fullName ?? item.recipientUserId}
                </p>
                <p className="text-muted-foreground text-sm">
                  {item.recipient?.email ?? 'unknown recipient'} · attempts: {item.attempts}
                </p>
                {item.status === 'FAILED' && item.lastError && (
                  <p className="text-danger text-sm">{item.lastError}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                {item.status === 'FAILED' && (
                  <Button
                    variant="secondary"
                    disabled={retryAction.isSubmitting}
                    onClick={() => void retryAction.run(item.id)}
                  >
                    Retry
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
