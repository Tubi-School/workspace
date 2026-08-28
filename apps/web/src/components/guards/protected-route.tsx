'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { useAuth } from '@/context/auth-context';
import { LoadingState } from '@/components/ui/states';
import type { RoleName } from '@/lib/types';

/**
 * Client-side route protection.
 *
 * The backend remains the sole authority on access — every request still
 * carries the bearer token and every endpoint re-enforces its own
 * RolesGuard/entitlement checks regardless of what this component decides.
 * This component exists purely for UX: it stops an unauthenticated or
 * wrong-role user from ever seeing a page's layout/shell flash before the
 * first API call would have rejected it with 401/403.
 */
export function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: ReactNode;
  allowedRoles?: RoleName[];
}) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      router.replace('/unauthorized');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, user, router]);

  if (isLoading) {
    return <LoadingState label="Checking your session…" />;
  }

  if (!user) {
    // Redirect is in flight (see effect above) — render nothing rather
    // than a flash of protected content.
    return null;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return null;
  }

  return <>{children}</>;
}
