import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { ProtectedRoute } from '@/components/guards/protected-route';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}
