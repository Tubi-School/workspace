'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@tubi/ui';
import { Badge } from '@/components/ui/badge';
import { Card, PageHeader } from '@/components/ui/card';
import { Field, TextInput, Textarea } from '@/components/ui/form';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useAsyncAction } from '@/hooks/use-async-action';
import { useFetch } from '@/hooks/use-fetch';
import { teachersApi } from '@/lib/endpoints';

export default function TeachersPage() {
  const { data, isLoading, error, refetch } = useFetch(teachersApi.list);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [bio, setBio] = useState('');

  const createAction = useAsyncAction(async () => {
    await teachersApi.create({
      email: email.trim(),
      password,
      fullName: fullName.trim(),
      bio: bio.trim() || undefined,
    });
    setEmail('');
    setPassword('');
    setFullName('');
    setBio('');
    refetch();
  });

  const toggleActiveAction = useAsyncAction(async (id: string, isActive: boolean) => {
    await teachersApi.update(id, { isActive });
    refetch();
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password || !fullName.trim()) return;
    void createAction.run();
  }

  return (
    <div>
      <PageHeader title="Teachers" description="Provision and manage teacher accounts." />

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">Add a teacher</h2>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" htmlFor="teacher-full-name">
            <TextInput
              id="teacher-full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={createAction.isSubmitting}
            />
          </Field>
          <Field label="Email" htmlFor="teacher-email">
            <TextInput
              id="teacher-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={createAction.isSubmitting}
            />
          </Field>
          <Field label="Temporary password" htmlFor="teacher-password">
            <TextInput
              id="teacher-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={createAction.isSubmitting}
              minLength={8}
            />
          </Field>
          <Field label="Bio (optional)" htmlFor="teacher-bio">
            <Textarea
              id="teacher-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              disabled={createAction.isSubmitting}
              rows={1}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={createAction.isSubmitting}>
              {createAction.isSubmitting ? 'Adding…' : 'Add teacher'}
            </Button>
          </div>
        </form>
        {createAction.error && <p className="text-danger mt-2 text-sm">{createAction.error}</p>}
      </Card>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {!isLoading && !error && data && data.length === 0 && (
        <EmptyState
          title="No teachers yet"
          description="Add the first teacher using the form above."
        />
      )}
      {!isLoading && !error && data && data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.map((teacher) => (
            <li
              key={teacher.id}
              className="border-border bg-surface-raised flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
            >
              <div>
                <p className="text-foreground text-sm font-medium">{teacher.user.fullName}</p>
                <p className="text-muted-foreground text-sm">{teacher.user.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={teacher.user.isActive ? 'success' : 'neutral'}>
                  {teacher.user.isActive ? 'Active' : 'Inactive'}
                </Badge>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void toggleActiveAction.run(teacher.id, !teacher.user.isActive)}
                  disabled={toggleActiveAction.isSubmitting}
                >
                  {teacher.user.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {toggleActiveAction.error && (
        <p className="text-danger mt-2 text-sm">{toggleActiveAction.error}</p>
      )}
    </div>
  );
}
