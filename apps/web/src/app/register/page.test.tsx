import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/context/auth-context';
import { clearStoredAccessToken } from '@/lib/api-client';
import RegisterPage from './page';

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

describe('RegisterPage', () => {
  beforeEach(() => {
    clearStoredAccessToken();
    replaceMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers, logs in, and redirects to the learner workspace — never sending a role', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/auth/register')) {
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () =>
            Promise.resolve({
              id: '1',
              email: 'new@tubi.school',
              fullName: 'New Learner',
              role: 'LEARNER',
              isActive: true,
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () =>
          Promise.resolve({
            accessToken: 'fake-token',
            user: {
              id: '1',
              email: 'new@tubi.school',
              fullName: 'New Learner',
              role: 'LEARNER',
              isActive: true,
            },
          }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider>
        <RegisterPage />
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText('Full name'), 'New Learner');
    await user.type(screen.getByLabelText('Email'), 'new@tubi.school');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/learner'));

    const registerCall = fetchMock.mock.calls.find((call) => {
      const [input] = call;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url.includes('/auth/register');
    });
    expect(registerCall).toBeDefined();
    const requestBody = JSON.parse(registerCall?.[1]?.body as string) as Record<string, unknown>;
    expect(requestBody).not.toHaveProperty('role');
    expect(requestBody).toEqual({
      email: 'new@tubi.school',
      password: 'correct-horse-battery',
      fullName: 'New Learner',
    });
  });

  it('shows the backend failure message on a duplicate-email rejection and does not redirect', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () =>
          Promise.resolve({
            statusCode: 409,
            message: 'An account with this email already exists',
          }),
      }),
    );

    render(
      <AuthProvider>
        <RegisterPage />
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText('Full name'), 'Someone');
    await user.type(screen.getByLabelText('Email'), 'existing@tubi.school');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
