'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useAuth } from '@/context/auth-context';
import { Badge } from '@/components/ui/badge';
import { cn } from '@tubi/ui';
import { NAV_BY_ROLE } from './nav-config';

function roleTone(role: string) {
  if (role === 'ADMIN') return 'brand' as const;
  if (role === 'TEACHER') return 'success' as const;
  return 'neutral' as const;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (!user) return <>{children}</>;

  const navItems = NAV_BY_ROLE[user.role];

  function handleLogout() {
    logout();
    router.replace('/login');
  }

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="border-border bg-surface-raised hidden w-64 shrink-0 flex-col border-r md:flex">
        <div className="border-border flex h-16 items-center gap-2 border-b px-5">
          <span className="text-foreground text-base font-semibold tracking-tight">TUBI</span>
          <span className="text-muted-foreground text-xs">Online School</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Primary">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand/10 text-brand'
                    : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-border border-t p-4">
          <p className="text-foreground truncate text-sm font-medium">{user.fullName}</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone={roleTone(user.role)}>{user.role}</Badge>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="text-muted-foreground hover:text-foreground mt-3 text-sm font-medium underline underline-offset-2"
          >
            Log out
          </button>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="border-border bg-surface-raised flex h-14 items-center justify-between border-b px-4 md:hidden">
          <span className="text-foreground text-base font-semibold">TUBI</span>
          <button
            type="button"
            onClick={() => setMobileNavOpen((open) => !open)}
            aria-expanded={mobileNavOpen}
            aria-label="Toggle navigation menu"
            className="border-border rounded-lg border p-2"
          >
            <span className="sr-only">Menu</span>
            <div className="flex flex-col gap-1">
              <span className="bg-foreground block h-0.5 w-5" />
              <span className="bg-foreground block h-0.5 w-5" />
              <span className="bg-foreground block h-0.5 w-5" />
            </div>
          </button>
        </header>

        {mobileNavOpen && (
          <nav className="border-border bg-surface-raised flex flex-col gap-1 border-b p-3 md:hidden">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileNavOpen(false)}
                className={cn(
                  'rounded-lg px-3 py-2 text-sm font-medium',
                  pathname === item.href
                    ? 'bg-brand/10 text-brand'
                    : 'text-muted-foreground hover:bg-surface-hover',
                )}
              >
                {item.label}
              </Link>
            ))}
            <div className="border-border mt-2 flex items-center justify-between border-t pt-3">
              <div>
                <p className="text-foreground text-sm font-medium">{user.fullName}</p>
                <Badge tone={roleTone(user.role)}>{user.role}</Badge>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="text-muted-foreground text-sm font-medium underline underline-offset-2"
              >
                Log out
              </button>
            </div>
          </nav>
        )}

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
