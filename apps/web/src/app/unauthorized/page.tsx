'use client';

import Link from 'next/link';

import { useAuth } from '@/context/auth-context';
import { homeRouteForRole } from '@/components/shell/nav-config';
import { ForbiddenState } from '@/components/ui/states';

export default function UnauthorizedPage() {
  const { user } = useAuth();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
      <ForbiddenState message="Your account does not have access to that section of TUBI Workspace." />
      {user && (
        <Link
          href={homeRouteForRole(user.role)}
          className="text-brand text-sm font-medium underline"
        >
          Back to your workspace
        </Link>
      )}
    </main>
  );
}
