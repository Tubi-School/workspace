import type { ReactNode } from 'react';

import { cn } from '@tubi/ui';

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'border-border border-t-brand inline-block h-5 w-5 animate-spin rounded-full border-2',
        className,
      )}
    />
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="text-muted-foreground flex items-center justify-center gap-3 py-16 text-sm">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="border-danger/30 bg-danger/5 flex flex-col items-center gap-3 rounded-xl border px-6 py-10 text-center">
      <p className="text-danger text-sm font-medium">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-brand text-sm font-medium underline underline-offset-2"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-border flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
      <p className="text-foreground text-sm font-medium">{title}</p>
      {description && <p className="text-muted-foreground max-w-sm text-sm">{description}</p>}
      {action}
    </div>
  );
}

export function ForbiddenState({
  message = "You don't have access to this page.",
}: {
  message?: string;
}) {
  return (
    <div className="border-warning/30 bg-warning/5 flex flex-col items-center gap-2 rounded-xl border px-6 py-10 text-center">
      <p className="text-foreground text-sm font-medium">Access restricted</p>
      <p className="text-muted-foreground text-sm">{message}</p>
    </div>
  );
}
