import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProtectedRoute } from '@/components/guards/protected-route';
import { AuthProvider, useAuth } from './auth-context';
import {
  apiRequest,
  clearStoredAccessToken,
  getStoredAccessToken,
  setStoredAccessToken,
} from '@/lib/api-client';

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe('AuthProvider / useAuth', () => {
  afterEach(() => {
    clearStoredAccessToken();
    vi.unstubAllGlobals();
  });

  it('restores no session when no token is stored', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();
  });

  it('restores the session via GET /auth/me when a token is already stored', async () => {
    setStoredAccessToken('existing-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () =>
          Promise.resolve({
            id: '1',
            email: 'learner@tubi.school',
            fullName: 'Lea Rner',
            role: 'LEARNER',
            isActive: true,
          }),
      }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user?.email).toBe('learner@tubi.school');
  });

  it('clears the session when the stored token is rejected (expired/invalid/inactive)', async () => {
    setStoredAccessToken('stale-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ statusCode: 401, message: 'Invalid or expired session' }),
      }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(getStoredAccessToken()).toBeNull();
  });

  it('logout clears both the user state and the stored token', async () => {
    setStoredAccessToken('some-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () =>
          Promise.resolve({
            id: '1',
            email: 'a@b.com',
            fullName: 'A',
            role: 'ADMIN',
            isActive: true,
          }),
      }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user).not.toBeNull());

    act(() => result.current.logout());

    expect(result.current.user).toBeNull();
    expect(getStoredAccessToken()).toBeNull();
  });

  describe('Correction 2 — active-session 401 invalidation', () => {
    it('invalidates the authenticated user state when a subsequent authenticated request returns 401', async () => {
      setStoredAccessToken('will-become-stale');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () =>
          Promise.resolve({
            id: '1',
            email: 'a@b.com',
            fullName: 'A',
            role: 'ADMIN',
            isActive: true,
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.user).not.toBeNull());

      // Simulates some other authenticated API call — made well after
      // startup, while the app believes it still has a valid session —
      // discovering the token is now invalid.
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ statusCode: 401, message: 'Invalid or expired session' }),
      });

      await expect(apiRequest('/admin/courses')).rejects.toThrow();

      await waitFor(() => expect(result.current.user).toBeNull());
      expect(getStoredAccessToken()).toBeNull();
    });

    it('a subsequently-invalidated session sends a protected route back to /login', async () => {
      setStoredAccessToken('will-become-stale');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () =>
          Promise.resolve({
            id: '1',
            email: 'a@b.com',
            fullName: 'A',
            role: 'ADMIN',
            isActive: true,
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      render(
        <AuthProvider>
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <div>Secret dashboard</div>
          </ProtectedRoute>
        </AuthProvider>,
      );

      expect(await screen.findByText('Secret dashboard')).toBeInTheDocument();

      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ statusCode: 401, message: 'Invalid or expired session' }),
      });

      await expect(apiRequest('/admin/whatever')).rejects.toThrow();

      await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
      expect(screen.queryByText('Secret dashboard')).not.toBeInTheDocument();
    });

    it('an ordinary login failure (invalid credentials) does not invalidate any existing session', async () => {
      setStoredAccessToken('a-perfectly-valid-token');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () =>
          Promise.resolve({
            id: '1',
            email: 'a@b.com',
            fullName: 'A',
            role: 'ADMIN',
            isActive: true,
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.user).not.toBeNull());

      // A completely unrelated login attempt (e.g. someone else at the
      // login page in another tab) fails with 401 — this must never touch
      // this already-authenticated session.
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ statusCode: 401, message: 'Invalid email or password' }),
      });

      await expect(result.current.login('someone-else@example.com', 'wrong')).rejects.toThrow(
        'Invalid email or password',
      );

      expect(result.current.user).not.toBeNull();
      expect(getStoredAccessToken()).toBe('a-perfectly-valid-token');
    });
  });
});
