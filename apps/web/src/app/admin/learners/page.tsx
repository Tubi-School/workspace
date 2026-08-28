'use client';

import { Button } from '@tubi/ui';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useAsyncAction } from '@/hooks/use-async-action';
import { useFetch } from '@/hooks/use-fetch';
import { learnersApi } from '@/lib/endpoints';

/**
 * Learners are created only through public self-registration (see
 * apps/api/src/auth/auth.service.ts) — there is no admin create endpoint,
 * so this page is intentionally read-plus-deactivate only. Fabricating a
 * "create learner" form here would not correspond to any real API.
 */
export default function LearnersPage() {
  const { data, isLoading, error, refetch } = useFetch(learnersApi.list);

  const toggleActiveAction = useAsyncAction(async (id: string, isActive: boolean) => {
    await learnersApi.update(id, { isActive });
    refetch();
  });

  return (
    <div>
      <PageHeader
        title="Learners"
        description="Learner accounts are created through self-registration. Deactivate an account here if needed."
      />

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {!isLoading && !error && data && data.length === 0 && (
        <EmptyState title="No learners have registered yet" />
      )}
      {!isLoading && !error && data && data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.map((learner) => (
            <li
              key={learner.id}
              className="border-border bg-surface-raised flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
            >
              <div>
                <p className="text-foreground text-sm font-medium">{learner.user.fullName}</p>
                <p className="text-muted-foreground text-sm">{learner.user.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={learner.user.isActive ? 'success' : 'neutral'}>
                  {learner.user.isActive ? 'Active' : 'Inactive'}
                </Badge>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void toggleActiveAction.run(learner.id, !learner.user.isActive)}
                  disabled={toggleActiveAction.isSubmitting}
                >
                  {learner.user.isActive ? 'Deactivate' : 'Reactivate'}
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
