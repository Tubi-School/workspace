import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { ProtectedRoute } from '@/components/guards/protected-route';

export default function LearnerLayout({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute allowedRoles={['LEARNER']}>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}
