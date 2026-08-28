import { API_BASE_URL } from '@/config/api';

/**
 * Every real route on the backend lives under this prefix (see
 * apps/api/src/main.ts: `app.setGlobalPrefix('api/v1', { exclude: [...] })`).
 * Health endpoints are the only exception and this frontend never calls them.
 */
const API_VERSION_PREFIX = '/api/v1';

const ACCESS_TOKEN_STORAGE_KEY = 'tubi.accessToken';

/**
 * Thrown for every non-2xx response. Carries the HTTP status and the
 * backend's own message (Nest's default exception shape is
 * `{ statusCode, message, error }`, where `message` is either a string or
 * an array of class-validator messages) — never a raw stack trace, and
 * never anything invented client-side.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Reads the persisted access token. `localStorage` is the only option
 * available: the backend issues a bearer token in the login response body,
 * not an httpOnly cookie, so there is no cookie-based alternative without
 * changing backend authentication semantics — explicitly out of scope for
 * this milestone. See docs/phase-3-frontend-implementation-review.txt
 * section N for the full trade-off this accepts and how it is mitigated. */
export function getStoredAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
}

export function setStoredAccessToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
}

export function clearStoredAccessToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
}

/**
 * Centralized session-invalidation mechanism (Phase 3 external review,
 * Correction 2). A 401 from an AUTHENTICATED request — one that carried a
 * bearer token, i.e. `skipAuth` was not set — means the token the app is
 * holding is no longer valid (expired, or the account was deactivated
 * mid-session): the JWT strategy re-checks `isActive` on every request, so
 * this can legitimately happen at any time while the app is already open,
 * not only at startup. Every such response notifies every listener
 * exactly once, in one place, rather than requiring every page/hook that
 * calls the API to handle 401 individually.
 *
 * `POST /auth/login` never triggers this: it is always called with
 * `skipAuth: true` (see `authApi.login`), so an invalid-credentials 401
 * there is never mistaken for an existing session going invalid.
 */
type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) listener();
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Omit the Authorization header even if a token is stored — only used
   * for the login/register endpoints, which authenticate the caller. */
  skipAuth?: boolean;
  /** Passed straight through to `fetch`. Lets a request outlive page
   * teardown (navigation/tab close) — the browser is asked to keep trying
   * to send it even after the page that started it is gone, rather than
   * aborting it outright the way an ordinary in-flight fetch is. Used only
   * for a final best-effort delivery attempt (e.g. RecordingPlayer's
   * pagehide/unmount flush) — never a guarantee, since a hard browser
   * kill (crash, forced process termination) can still drop it before the
   * OS/browser has a chance to send anything. See RecordingPlayer's own
   * doc comment for the honestly-bounded limit this accepts. */
  keepalive?: boolean;
}

function extractMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.filter((m) => typeof m === 'string').join(' ');
  }
  return fallback;
}

/**
 * The single place every frontend feature reaches the real Phase 2G API
 * through. Adds the versioned prefix, attaches the bearer token, and
 * normalizes every failure into an `ApiError` — no page ever calls
 * `fetch` directly, so there is exactly one place that could leak a token
 * or mis-handle an error, and it is this one.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, skipAuth = false, keepalive = false } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (!skipAuth) {
    const token = getStoredAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${API_VERSION_PREFIX}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      keepalive,
    });
  } catch {
    // Network failure (API unreachable, CORS, offline) — never surface the
    // raw TypeError to a user.
    throw new ApiError(0, 'Could not reach the TUBI server. Check your connection and try again.');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false;
  const payload: unknown = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    if (response.status === 401 && !skipAuth) {
      // The token this request just carried is no longer valid — clear it
      // and tell every listener (there is exactly one: AuthContext) so the
      // whole app treats this precisely like a fresh logout, regardless of
      // which page or hook happened to make the request that discovered it.
      clearStoredAccessToken();
      notifyUnauthorized();
    }

    throw new ApiError(
      response.status,
      extractMessage(payload, `Request failed (${response.status})`),
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(
    path: string,
    body?: unknown,
    options?: Pick<RequestOptions, 'skipAuth' | 'keepalive'>,
  ) => apiRequest<T>(path, { method: 'POST', body, ...options }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};
