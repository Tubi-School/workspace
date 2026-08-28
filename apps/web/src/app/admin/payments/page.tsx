'use client';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useFetch } from '@/hooks/use-fetch';
import { paymentsApi } from '@/lib/endpoints';
import type { PaymentStatus } from '@/lib/types';

const STATUS_TONE: Record<PaymentStatus, BadgeTone> = {
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'danger',
  CANCELED: 'neutral',
  REFUNDED: 'neutral',
};

function formatAmount(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

/**
 * Launch-console visibility into the commercial layer (section W). Read
 * only — a PaymentOrder's true state may only ever change through a
 * verified provider webhook (PaymentsService.confirmPayment/failPayment),
 * never an ADMIN click.
 */
export default function AdminPaymentsPage() {
  const orders = useFetch(paymentsApi.listAll);

  if (orders.isLoading) return <LoadingState />;
  if (orders.error) return <ErrorState message={orders.error} onRetry={orders.refetch} />;

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Every checkout initiated and its verified outcome — access is only ever granted from a confirmed provider webhook."
      />

      {orders.data && orders.data.length === 0 && <EmptyState title="No payment orders yet" />}

      {orders.data && orders.data.length > 0 && (
        <Card>
          <ul className="divide-border flex flex-col divide-y">
            {orders.data.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-foreground text-sm font-medium">
                    {formatAmount(order.amountMinor, order.currency)} via {order.provider}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {new Date(order.createdAt).toLocaleString()}
                    {order.providerReference ? ` · ${order.providerReference}` : ''}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[order.status]}>{order.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
