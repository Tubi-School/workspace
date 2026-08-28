'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api-client';

/**
 * Wraps a mutation (create/update/delete/lifecycle action) with submission
 * state and duplicate-submission prevention — every form and action button
 * in this app uses this instead of tracking `isSubmitting` by hand.
 *
 * `action` is read through a ref kept current by an effect (never written
 * during render), rather than being a dependency of the memoized `run`
 * callback. The caller almost always passes a fresh closure (over current
 * form-field state) on every render; depending on it directly would
 * recreate `run` every render, and NOT depending on it (the bug this shape
 * specifically avoids) would capture a stale closure over whatever state
 * existed the first time `run` was created, silently submitting outdated
 * values forever after. The in-flight guard uses its own ref for the same
 * reason — reading `isSubmitting` state directly inside a `useCallback`
 * with an empty dependency array would read a permanently-stale value.
 */
export function useAsyncAction<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result>,
) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current = action;
  });
  const inFlightRef = useRef(false);

  const run = useCallback(async (...args: Args): Promise<Result | undefined> => {
    if (inFlightRef.current) return undefined; // prevents accidental duplicate submission
    inFlightRef.current = true;
    setIsSubmitting(true);
    setError(null);

    try {
      return await actionRef.current(...args);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.',
      );
      return undefined;
    } finally {
      inFlightRef.current = false;
      setIsSubmitting(false);
    }
  }, []);

  return { run, isSubmitting, error, clearError: () => setError(null) };
}
