import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { ProtectedRoute } from '@/components/guards/protected-route';

export default function TeacherLayout({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute allowedRoles={['TEACHER']}>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}
