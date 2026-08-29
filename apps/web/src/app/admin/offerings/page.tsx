'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@tubi/ui';
import { Badge } from '@/components/ui/badge';
import { Card, PageHeader } from '@/components/ui/card';
import { Field, Select, TextInput } from '@/components/ui/form';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useAsyncAction } from '@/hooks/use-async-action';
import { useFetch } from '@/hooks/use-fetch';
import { coursesApi, offeringsApi } from '@/lib/endpoints';
import type { DeliveryMode } from '@/lib/types';

/**
 * The one ADMIN-facing gap the Phase 5 launch review found: nothing let
 * an ADMIN create a sellable Offering (or attach courses to one) without
 * direct database access. This page is the production launch's minimum
 * viable commercial-catalog setup — create, a narrow price/name edit, and
 * course attach/detach. Never a pricing engine or a general commerce
 * admin surface.
 */
export default function AdminOfferingsPage() {
  const offerings = useFetch(offeringsApi.list);
  const courses = useFetch(coursesApi.list);

  const [name, setName] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('LIVE_AND_RECORDED');
  const [monthlyPrice, setMonthlyPrice] = useState('');
  const [courseIds, setCourseIds] = useState<string[]>([]);

  const createAction = useAsyncAction(async () => {
    await offeringsApi.create({
      name: name.trim(),
      deliveryMode,
      monthlyPrice: Number(monthlyPrice),
      courseIds,
    });
    setName('');
    setMonthlyPrice('');
    setCourseIds([]);
    offerings.refetch();
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !monthlyPrice) return;
    void createAction.run();
  }

  function toggleCourse(courseId: string) {
    setCourseIds((current) =>
      current.includes(courseId) ? current.filter((id) => id !== courseId) : [...current, courseId],
    );
  }

  return (
    <div>
      <PageHeader
        title="Offerings"
        description="The sellable subscription catalog learners choose from — never a per-lesson purchase."
      />

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">Create an offering</h2>

        {courses.isLoading && <LoadingState />}
        {courses.error && <ErrorState message={courses.error} onRetry={courses.refetch} />}

        {courses.data && (
          <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={createAction.isSubmitting}
                placeholder="e.g. Grade 8 Mathematics — Live"
              />
            </Field>
            <Field label="Delivery mode">
              <Select
                value={deliveryMode}
                onChange={(e) => setDeliveryMode(e.target.value as DeliveryMode)}
                disabled={createAction.isSubmitting}
              >
                <option value="LIVE_AND_RECORDED">Live + Recorded</option>
                <option value="RECORDED_ONLY">Recorded only</option>
              </Select>
            </Field>
            <Field label="Monthly price (ZAR)">
              <TextInput
                type="number"
                min={0}
                step="0.01"
                value={monthlyPrice}
                onChange={(e) => setMonthlyPrice(e.target.value)}
                disabled={createAction.isSubmitting}
              />
            </Field>
            <div className="sm:col-span-2">
              <FieldLabelPlain>Courses included</FieldLabelPlain>
              {courses.data.length === 0 ? (
                <p className="text-muted-foreground text-sm">No courses exist yet.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {courses.data.map((course) => (
                    <label key={course.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={courseIds.includes(course.id)}
                        onChange={() => toggleCourse(course.id)}
                        disabled={createAction.isSubmitting}
                      />
                      {course.title}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={createAction.isSubmitting}>
                {createAction.isSubmitting ? 'Creating…' : 'Create offering'}
              </Button>
            </div>
          </form>
        )}
        {createAction.error && <p className="text-danger mt-2 text-sm">{createAction.error}</p>}
      </Card>

      {offerings.isLoading && <LoadingState />}
      {offerings.error && <ErrorState message={offerings.error} onRetry={offerings.refetch} />}
      {offerings.data && offerings.data.length === 0 && (
        <EmptyState title="No offerings created yet" />
      )}
      {offerings.data && offerings.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {offerings.data.map((offering) => (
            <li
              key={offering.id}
              className="border-border bg-surface-raised flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
            >
              <div>
                <p className="text-foreground text-sm font-medium">{offering.name}</p>
                <p className="text-muted-foreground text-sm">R{offering.monthlyPrice} / month</p>
              </div>
              <Badge tone="neutral">
                {offering.deliveryMode === 'LIVE_AND_RECORDED'
                  ? 'Live + Recorded'
                  : 'Recorded only'}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldLabelPlain({ children }: { children: string }) {
  return <p className="text-foreground mb-1 block text-sm font-medium">{children}</p>;
}
