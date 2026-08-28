import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { AuthProvider } from '@/context/auth-context';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'TUBI Workspace',
    template: '%s · TUBI Workspace',
  },
  description: 'The operational platform for TUBI Online School.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * Application shell.
 *
 * Typography comes from the `--font-sans` token in the design system, which
 * resolves to a locally installed Inter and falls back to the platform UI font.
 * No webfont is fetched at build time, so the build stays hermetic.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-surface text-foreground font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
