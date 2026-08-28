'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@tubi/ui';
import { Card, PageHeader } from '@/components/ui/card';
import { Field, TextInput } from '@/components/ui/form';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useAsyncAction } from '@/hooks/use-async-action';
import { useFetch } from '@/hooks/use-fetch';
import { academicTermsApi } from '@/lib/endpoints';

export default function AcademicTermsPage() {
  const { data, isLoading, error, refetch } = useFetch(academicTermsApi.list);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const createAction = useAsyncAction(async () => {
    await academicTermsApi.create({ name: name.trim(), startDate, endDate });
    setName('');
    setStartDate('');
    setEndDate('');
    refetch();
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !startDate || !endDate) return;
    void createAction.run();
  }

  return (
    <div>
      <PageHeader
        title="Academic Terms"
        description="The school calendar periods every course and session is scheduled within."
      />

      <Card className="mb-6">
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <Field label="Name" htmlFor="term-name">
            <TextInput
              id="term-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Term 3, 2026"
              disabled={createAction.isSubmitting}
            />
          </Field>
          <Field label="Start date" htmlFor="term-start-date">
            <TextInput
              id="term-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={createAction.isSubmitting}
            />
          </Field>
          <Field label="End date" htmlFor="term-end-date">
            <TextInput
              id="term-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={createAction.isSubmitting}
            />
          </Field>
          <Button type="submit" disabled={createAction.isSubmitting}>
            {createAction.isSubmitting ? 'Adding…' : 'Add term'}
          </Button>
        </form>
        {createAction.error && <p className="text-danger mt-2 text-sm">{createAction.error}</p>}
      </Card>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {!isLoading && !error && data && data.length === 0 && (
        <EmptyState
          title="No academic terms yet"
          description="Add the first term using the form above."
        />
      )}
      {!isLoading && !error && data && data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.map((term) => (
            <li
              key={term.id}
              className="border-border bg-surface-raised flex flex-col gap-1 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-foreground text-sm font-medium">{term.name}</span>
              <span className="text-muted-foreground text-sm">
                {new Date(term.startDate).toLocaleDateString()} –{' '}
                {new Date(term.endDate).toLocaleDateString()} ({term.timezone})
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
