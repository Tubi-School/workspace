import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-foreground hover:bg-brand-hover',
  secondary: 'bg-surface-raised text-foreground border border-border hover:bg-surface-hover',
  ghost: 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-6 text-base',
};

/**
 * The workspace's primary action element.
 *
 * Deliberately unopinionated about behaviour — it renders a native `<button>`
 * and forwards every attribute — so that feature work can layer routing, form
 * submission or async state on top without forking the component.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
        'transition-colors duration-150 ease-out',
        'focus-visible:ring-brand focus-visible:ring-2 focus-visible:ring-offset-2',
        'focus-visible:ring-offset-surface focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
