'use client';

import { Button } from '@tubi/ui';
import { Card, PageHeader } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useAsyncAction } from '@/hooks/use-async-action';
import { useFetch } from '@/hooks/use-fetch';
import { paymentsApi } from '@/lib/endpoints';

/**
 * Learner-facing commercial discovery + checkout handoff (section R).
 * TUBI remains subscription/access based — there is deliberately no
 * lesson-by-lesson purchase here, only the same Offering catalog ADMIN
 * already manages. Checkout hands the learner a real provider (Paystack)
 * checkout URL; SubscriptionAccess itself is only ever granted later, by
 * the backend's verified payment webhook — this page never claims access
 * has been granted just because a redirect came back looking successful.
 */
export default function LearnerSubscriptionPage() {
  const offerings = useFetch(() => paymentsApi.listOfferings(), []);

  const checkoutAction = useAsyncAction(async (offeringId: string) => {
    const { checkoutUrl } = await paymentsApi.checkout(offeringId);
    window.location.href = checkoutUrl;
  });

  if (offerings.isLoading) return <LoadingState />;
  if (offerings.error) return <ErrorState message={offerings.error} onRetry={offerings.refetch} />;

  return (
    <div>
      <PageHeader
        title="Subscription"
        description="Choose a TUBI subscription to gain access to your classes."
      />

      {checkoutAction.error && (
        <p role="alert" className="text-danger mb-4 text-sm font-medium">
          {checkoutAction.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {offerings.data?.map((offering) => (
          <Card key={offering.id}>
            <h2 className="text-sm font-semibold">{offering.name}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {offering.deliveryMode === 'LIVE_AND_RECORDED'
                ? 'Live classes plus recordings'
                : 'Recordings only'}
            </p>
            <p className="mt-2 text-lg font-semibold">R{offering.monthlyPrice} / month</p>
            <Button
              size="sm"
              className="mt-3"
              disabled={checkoutAction.isSubmitting}
              onClick={() => void checkoutAction.run(offering.id)}
            >
              {checkoutAction.isSubmitting ? 'Redirecting…' : 'Subscribe'}
            </Button>
          </Card>
        ))}
        {offerings.data?.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No subscription offerings are available yet.
          </p>
        )}
      </div>
    </div>
  );
}
