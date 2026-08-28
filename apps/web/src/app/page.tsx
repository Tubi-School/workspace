'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/context/auth-context';
import { homeRouteForRole } from '@/components/shell/nav-config';
import { LoadingState } from '@/components/ui/states';

/**
 * The root route never renders content of its own — it only decides where
 * to send the visitor: an authenticated user goes straight to their role's
 * workspace, everyone else goes to /login.
 */
export default function RootPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    router.replace(user ? homeRouteForRole(user.role) : '/login');
  }, [isLoading, user, router]);

  return <LoadingState label="Loading TUBI Workspace…" />;
}
