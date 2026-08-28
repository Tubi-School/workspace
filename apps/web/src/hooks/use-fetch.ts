'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api-client';

export interface FetchState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  /** True once the request has settled (success or failure) at least once —
   * lets a page distinguish "first load" from "refetch after a mutation"
   * without a separate flag. */
  status: 'loading' | 'success' | 'error';
  refetch: () => void;
}

/**
 * Runs `fetcher` on mount and whenever `deps` changes, exposing exactly the
 * four states every real-data screen in this app is required to handle
 * (loading / success / empty-is-just-an-empty-array / error) — see
 * docs/phase-3-frontend-implementation-review.txt section C. Every list/
 * detail page in this application uses this hook rather than calling the
 * API client directly, so loading/error handling is not re-implemented per
 * page.
 */
export function useFetch<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[] = [],
): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Kept current via an effect (not written during render) so the fetch
  // effect below always calls the latest closure without needing `fetcher`
  // itself — usually a fresh inline closure every render — as a dependency,
  // which would otherwise refetch on every render.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setStatus('loading');
      setError(null);

      try {
        const result = await fetcherRef.current();
        if (cancelled) return;
        setData(result);
        setStatus('success');
      } catch (caught) {
        if (cancelled) return;
        const message =
          caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.';
        setError(message);
        setStatus('error');
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken, ...deps]);

  const refetch = useCallback(() => setReloadToken((token) => token + 1), []);

  return { data, isLoading: status === 'loading', error, status, refetch };
}
