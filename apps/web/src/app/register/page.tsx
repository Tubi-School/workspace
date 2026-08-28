'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@tubi/ui';
import { homeRouteForRole } from '@/components/shell/nav-config';
import { Field, TextInput } from '@/components/ui/form';
import { useAuth } from '@/context/auth-context';
import { useAsyncAction } from '@/hooks/use-async-action';
import { authApi } from '@/lib/endpoints';

/**
 * Public self-registration (section M). Only ever produces a LEARNER
 * account — there is no role selector here, mirroring the backend's own
 * `AuthService.register`, which ignores anything but the fixed LEARNER
 * role for a public caller. TEACHER/ADMIN accounts remain provisioned
 * only through the ADMIN-only `/admin/teachers` flow.
 */
export default function RegisterPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const { run, isSubmitting, error } = useAsyncAction(async () => {
    await authApi.register(email, password, fullName);
    const user = await login(email, password);
    router.replace(homeRouteForRole(user.role));
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void run();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            TUBI Online School
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Create your account</h1>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="border-border bg-surface-raised flex flex-col gap-4 rounded-xl border p-6"
        >
          <Field label="Full name" htmlFor="fullName">
            <TextInput
              id="fullName"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={isSubmitting}
            />
          </Field>

          <Field label="Email" htmlFor="email">
            <TextInput
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
            />
          </Field>

          <Field label="Password" htmlFor="password">
            <TextInput
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
            />
          </Field>

          {error && (
            <p role="alert" className="text-danger text-sm font-medium">
              {error}
            </p>
          )}

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </div>
    </main>
  );
}
