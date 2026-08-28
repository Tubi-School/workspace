'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';

import Link from 'next/link';

import { useAuth } from '@/context/auth-context';
import { homeRouteForRole } from '@/components/shell/nav-config';
import { Field, TextInput } from '@/components/ui/form';
import { useAsyncAction } from '@/hooks/use-async-action';
import { Button } from '@tubi/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const { run, isSubmitting, error } = useAsyncAction(async () => {
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
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sign in</h1>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="border-border bg-surface-raised flex flex-col gap-4 rounded-xl border p-6"
        >
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
              autoComplete="current-password"
              required
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
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="text-muted-foreground mt-4 text-center text-sm">
          New to TUBI?{' '}
          <Link href="/register" className="text-foreground font-medium underline">
            Create a learner account
          </Link>
        </p>
      </div>
    </main>
  );
}
