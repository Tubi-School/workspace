'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@tubi/ui';
import { Card, PageHeader } from '@/components/ui/card';
import { Field, TextInput } from '@/components/ui/form';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useAsyncAction } from '@/hooks/use-async-action';
import { useFetch } from '@/hooks/use-fetch';

interface NamedEntity {
  id: string;
  name: string;
}

/**
 * Shared list+create+rename+delete UI for the two catalog entities that are
 * genuinely just "a unique name" at the API level — GradeLevel and Subject
 * (apps/api/src/grade-levels, apps/api/src/subjects). AcademicTerm and
 * Course carry enough additional fields that they get their own pages
 * instead of reusing this.
 */
export function NamedEntityManager({
  title,
  description,
  fetchAll,
  create,
  update,
  remove,
}: {
  title: string;
  description: string;
  fetchAll: () => Promise<NamedEntity[]>;
  create: (name: string) => Promise<NamedEntity>;
  update: (id: string, name: string) => Promise<NamedEntity>;
  remove: (id: string) => Promise<void>;
}) {
  const { data, isLoading, error, refetch } = useFetch(fetchAll);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const createAction = useAsyncAction(async () => {
    await create(newName.trim());
    setNewName('');
    refetch();
  });

  const updateAction = useAsyncAction(async (id: string, name: string) => {
    await update(id, name);
    setEditingId(null);
    refetch();
  });

  const removeAction = useAsyncAction(async (id: string) => {
    await remove(id);
    refetch();
  });

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (newName.trim().length === 0) return;
    void createAction.run();
  }

  return (
    <div>
      <PageHeader title={title} description={description} />

      <Card className="mb-6">
        <form onSubmit={handleCreate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Name" htmlFor="new-entity-name">
              <TextInput
                id="new-entity-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Grade 8"
                disabled={createAction.isSubmitting}
              />
            </Field>
          </div>
          <Button type="submit" disabled={createAction.isSubmitting || newName.trim().length === 0}>
            {createAction.isSubmitting ? 'Adding…' : 'Add'}
          </Button>
        </form>
        {createAction.error && <p className="text-danger mt-2 text-sm">{createAction.error}</p>}
      </Card>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {!isLoading && !error && data && data.length === 0 && (
        <EmptyState
          title="Nothing here yet"
          description={`Add the first item using the form above.`}
        />
      )}

      {!isLoading && !error && data && data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.map((item) => (
            <li
              key={item.id}
              className="border-border bg-surface-raised flex items-center gap-3 rounded-lg border px-4 py-3"
            >
              {editingId === item.id ? (
                <>
                  <TextInput
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="flex-1"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    onClick={() => void updateAction.run(item.id, editingName.trim())}
                    disabled={updateAction.isSubmitting || editingName.trim().length === 0}
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-foreground flex-1 text-sm font-medium">{item.name}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditingId(item.id);
                      setEditingName(item.name);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void removeAction.run(item.id)}
                    disabled={removeAction.isSubmitting}
                  >
                    Delete
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {updateAction.error && <p className="text-danger mt-2 text-sm">{updateAction.error}</p>}
      {removeAction.error && <p className="text-danger mt-2 text-sm">{removeAction.error}</p>}
    </div>
  );
}
