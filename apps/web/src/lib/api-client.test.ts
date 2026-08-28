import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  apiRequest,
  clearStoredAccessToken,
  getStoredAccessToken,
  onUnauthorized,
  setStoredAccessToken,
} from './api-client';

describe('apiRequest', () => {
  afterEach(() => {
    clearStoredAccessToken();
    vi.unstubAllGlobals();
  });

  it('prefixes every request with /api/v1 and attaches a stored bearer token', async () => {
    setStoredAccessToken('secret-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/admin/courses');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/admin/courses');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
  });

  it('never attaches a token for skipAuth requests (login/register)', async () => {
    setStoredAccessToken('secret-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/auth/login', { method: 'POST', body: {}, skipAuth: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('throws ApiError with the backend-provided message on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ statusCode: 403, message: 'Forbidden resource' }),
      }),
    );

    await expect(apiRequest('/admin/courses')).rejects.toMatchObject(
      new ApiError(403, 'Forbidden resource'),
    );
  });

  it('joins a class-validator message array into one readable string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () =>
          Promise.resolve({
            statusCode: 400,
            message: ['name must not be empty', 'name too long'],
          }),
      }),
    );

    await expect(apiRequest('/admin/subjects')).rejects.toThrow(
      'name must not be empty name too long',
    );
  });

  it('never leaks a raw network error — surfaces a clean message instead', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiRequest('/admin/courses')).rejects.toThrow(/could not reach the tubi server/i);
  });

  it('a 401 from an authenticated request clears the stored token and notifies onUnauthorized listeners (Correction 2)', async () => {
    setStoredAccessToken('now-stale-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ statusCode: 401, message: 'Invalid or expired session' }),
      }),
    );
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);

    await expect(apiRequest('/admin/courses')).rejects.toThrow('Invalid or expired session');

    expect(getStoredAccessToken()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does NOT treat a 401 from POST /auth/login (skipAuth) as session invalidation — no listener is notified', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ statusCode: 401, message: 'Invalid email or password' }),
      }),
    );
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);

    await expect(
      apiRequest('/auth/login', { method: 'POST', body: {}, skipAuth: true }),
    ).rejects.toThrow('Invalid email or password');

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('token storage round-trips and clears cleanly', () => {
    expect(getStoredAccessToken()).toBeNull();
    setStoredAccessToken('abc');
    expect(getStoredAccessToken()).toBe('abc');
    clearStoredAccessToken();
    expect(getStoredAccessToken()).toBeNull();
  });
});
