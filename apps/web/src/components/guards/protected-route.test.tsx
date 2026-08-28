import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SanitizedUser } from '@/lib/types';
import { ProtectedRoute } from './protected-route';

interface MockAuthState {
  user: SanitizedUser | null;
  isLoading: boolean;
}

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

const mockUseAuth = vi.fn<() => MockAuthState>();
vi.mock('@/context/auth-context', () => ({
  useAuth: (): MockAuthState => mockUseAuth(),
}));

describe('ProtectedRoute', () => {
  beforeEach(() => {
    replaceMock.mockClear();
  });

  it('shows a loading state and renders nothing while the session is being restored', () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: true });

    render(
      <ProtectedRoute>
        <div>Secret content</div>
      </ProtectedRoute>,
    );

    expect(screen.queryByText('Secret content')).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('redirects to /login when there is no authenticated user', async () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: false });

    render(
      <ProtectedRoute>
        <div>Secret content</div>
      </ProtectedRoute>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument();
  });

  it('redirects to /unauthorized when the user is authenticated but holds the wrong role', async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: '1',
        email: 'a@b.com',
        fullName: 'A',
        role: 'LEARNER',
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      isLoading: false,
    });

    render(
      <ProtectedRoute allowedRoles={['ADMIN']}>
        <div>Secret content</div>
      </ProtectedRoute>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/unauthorized'));
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument();
  });

  it('renders the protected content for an authenticated user with an allowed role', () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: '1',
        email: 'a@b.com',
        fullName: 'A',
        role: 'ADMIN',
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      isLoading: false,
    });

    render(
      <ProtectedRoute allowedRoles={['ADMIN']}>
        <div>Secret content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText('Secret content')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
