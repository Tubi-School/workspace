import type { ReactNode } from 'react';

import { cn } from '@tubi/ui';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'brand';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface-raised text-muted-foreground border-border',
  success: 'bg-success/10 text-success border-success/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
  brand: 'bg-brand/10 text-brand border-brand/30',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}
