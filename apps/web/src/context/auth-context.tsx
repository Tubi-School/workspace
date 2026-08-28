'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { authApi } from '@/lib/endpoints';
import {
  clearStoredAccessToken,
  getStoredAccessToken,
  onUnauthorized,
  setStoredAccessToken,
} from '@/lib/api-client';
import type { SanitizedUser } from '@/lib/types';

interface AuthContextValue {
  user: SanitizedUser | null;
  /** True while the initial session-restoration check is in flight — every
   * protected route must wait for this before deciding to redirect, or a
   * refresh would always bounce a genuinely logged-in user to /login. */
  isLoading: boolean;
  login: (email: string, password: string) => Promise<SanitizedUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SanitizedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const token = getStoredAccessToken();
      if (!token) {
        if (!cancelled) setIsLoading(false);
        return;
      }

      // Re-checks the token against the backend rather than trusting a
      // stale local copy — mirrors JwtStrategy's own "re-check isActive on
      // every request" behavior for the one request that restores a
      // session.
      try {
        const restoredUser = await authApi.me();
        if (!cancelled) setUser(restoredUser);
      } catch {
        // Invalid, expired, or the account is no longer active/does not
        // exist — the same outcome as never having logged in.
        clearStoredAccessToken();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { accessToken, user: loggedInUser } = await authApi.login(email, password);
    setStoredAccessToken(accessToken);
    setUser(loggedInUser);
    return loggedInUser;
  }, []);

  const logout = useCallback(() => {
    clearStoredAccessToken();
    setUser(null);
  }, []);

  // Phase 3 external review Correction 2: the ONE centralized place a 401
  // from an already-authenticated request (token expired, or the account
  // was deactivated while this session was open) invalidates the local
  // session — api-client.ts already cleared the stored token before
  // notifying; this just brings React state in line with that, which is
  // what makes ProtectedRoute redirect to /login on the very next render.
  // A `POST /auth/login` credential failure never reaches this listener —
  // that call is always made with `skipAuth: true`.
  useEffect(() => onUnauthorized(() => setUser(null)), []);

  const value = useMemo(
    () => ({ user, isLoading, login, logout }),
    [user, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
