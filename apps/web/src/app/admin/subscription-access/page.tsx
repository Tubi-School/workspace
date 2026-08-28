'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@tubi/ui';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, PageHeader } from '@/components/ui/card';
import { Field, Select, TextInput } from '@/components/ui/form';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useAsyncAction } from '@/hooks/use-async-action';
import { useFetch } from '@/hooks/use-fetch';
import { learnersApi, offeringsApi, subscriptionAccessApi } from '@/lib/endpoints';
import type { SubscriptionStatus } from '@/lib/types';

const STATUS_TONE: Record<SubscriptionStatus, BadgeTone> = {
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  CANCELED: 'neutral',
  EXPIRED: 'neutral',
};

async function fetchFormOptions() {
  const [learners, offerings] = await Promise.all([learnersApi.list(), offeringsApi.list()]);
  return { learners, offerings };
}

export default function SubscriptionAccessPage() {
  const grants = useFetch(subscriptionAccessApi.list);
  const options = useFetch(fetchFormOptions);

  const [learnerId, setLearnerId] = useState('');
  const [offeringId, setOfferingId] = useState('');
  const [currentPeriodStart, setCurrentPeriodStart] = useState('');
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState('');

  const createAction = useAsyncAction(async () => {
    await subscriptionAccessApi.create({
      learnerId,
      offeringId,
      currentPeriodStart,
      currentPeriodEnd,
    });
    setOfferingId('');
    setCurrentPeriodStart('');
    setCurrentPeriodEnd('');
    grants.refetch();
  });

  const revokeAction = useAsyncAction(async (id: string) => {
    await subscriptionAccessApi.revoke(id);
    grants.refetch();
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!learnerId || !offeringId || !currentPeriodStart || !currentPeriodEnd) return;
    void createAction.run();
  }

  const offeringNameById = new Map((options.data?.offerings ?? []).map((o) => [o.id, o.name]));

  return (
    <div>
      <PageHeader
        title="Subscription Access"
        description="Grant a learner access to an Offering for a time window — never a per-lesson purchase."
      />

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">Grant access</h2>

        {options.isLoading && <LoadingState />}
        {options.error && <ErrorState message={options.error} onRetry={options.refetch} />}

        {options.data && options.data.offerings.length === 0 && (
          <EmptyState
            title="No offerings exist yet"
            description="An Offering must exist before a subscription grant can reference one."
          />
        )}

        {options.data && options.data.offerings.length > 0 && (
          <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
            <Field label="Learner" htmlFor="grant-learner">
              <Select
                id="grant-learner"
                value={learnerId}
                onChange={(e) => setLearnerId(e.target.value)}
                disabled={createAction.isSubmitting}
              >
                <option value="">Select a learner</option>
                {options.data.learners.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.user.fullName} ({l.user.email})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Offering" htmlFor="grant-offering">
              <Select
                id="grant-offering"
                value={offeringId}
                onChange={(e) => setOfferingId(e.target.value)}
                disabled={createAction.isSubmitting}
              >
                <option value="">Select an offering</option>
                {options.data.offerings.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} (
                    {o.deliveryMode === 'LIVE_AND_RECORDED' ? 'Live + Recorded' : 'Recorded only'})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Period start" htmlFor="grant-period-start">
              <TextInput
                id="grant-period-start"
                type="date"
                value={currentPeriodStart}
                onChange={(e) => setCurrentPeriodStart(e.target.value)}
                disabled={createAction.isSubmitting}
              />
            </Field>
            <Field label="Period end" htmlFor="grant-period-end">
              <TextInput
                id="grant-period-end"
                type="date"
                value={currentPeriodEnd}
                onChange={(e) => setCurrentPeriodEnd(e.target.value)}
                disabled={createAction.isSubmitting}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={createAction.isSubmitting}>
                {createAction.isSubmitting ? 'Granting…' : 'Grant access'}
              </Button>
            </div>
          </form>
        )}
        {createAction.error && <p className="text-danger mt-2 text-sm">{createAction.error}</p>}
      </Card>

      {grants.isLoading && <LoadingState />}
      {grants.error && <ErrorState message={grants.error} onRetry={grants.refetch} />}
      {grants.data && grants.data.length === 0 && <EmptyState title="No access grants yet" />}
      {grants.data && grants.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {grants.data.map((grant) => (
            <li
              key={grant.id}
              className="border-border bg-surface-raised flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
            >
              <div>
                <p className="text-foreground text-sm font-medium">
                  {offeringNameById.get(grant.offeringId) ?? `Offering ${grant.offeringId}`}
                </p>
                <p className="text-muted-foreground text-sm">
                  {new Date(grant.currentPeriodStart).toLocaleDateString()} –{' '}
                  {new Date(grant.currentPeriodEnd).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={STATUS_TONE[grant.status]}>{grant.status}</Badge>
                {(grant.status === 'ACTIVE' || grant.status === 'PAST_DUE') && (
                  <Button size="sm" variant="ghost" onClick={() => void revokeAction.run(grant.id)}>
                    Revoke
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {revokeAction.error && <p className="text-danger mt-2 text-sm">{revokeAction.error}</p>}
    </div>
  );
}
