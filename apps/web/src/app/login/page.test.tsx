import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/context/auth-context';
import { clearStoredAccessToken } from '@/lib/api-client';
import LoginPage from './page';

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    clearStoredAccessToken();
    replaceMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('logs in successfully and redirects to the role-appropriate workspace', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () =>
          Promise.resolve({
            accessToken: 'fake-token',
            user: {
              id: '1',
              email: 'admin@tubi.school',
              fullName: 'Ada Min',
              role: 'ADMIN',
              isActive: true,
            },
          }),
      }),
    );

    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText('Email'), 'admin@tubi.school');
    await user.type(screen.getByLabelText('Password'), 'correct-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/admin'));
  });

  it('shows the backend failure message on a failed login and does not redirect', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ statusCode: 401, message: 'Invalid email or password' }),
      }),
    );

    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText('Email'), 'wrong@tubi.school');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
