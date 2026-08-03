import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind class names, resolving conflicts in favour of the last value.
 *
 * `clsx` handles conditionals and arrays; `tailwind-merge` then collapses
 * competing utilities so that a caller-supplied `className` can reliably
 * override a component's defaults (`p-2` + `p-4` becomes `p-4`, not both).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
