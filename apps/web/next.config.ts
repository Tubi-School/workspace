import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const appDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Fail the production build on a type error rather than shipping it. This is
  // Next's default; it is stated explicitly so nobody relaxes it by accident.
  // Linting is a separate Turborepo task, not part of `next build`.
  typescript: { ignoreBuildErrors: false },

  // `@tubi/ui` is published as TypeScript source rather than compiled output,
  // so Next compiles it with the app. That keeps React Server Component
  // directives intact and gives the design system fast refresh in development.
  transpilePackages: ['@tubi/ui'],

  // Required for `next build` to trace the correct workspace root in a
  // monorepo; without it Next may infer the wrong directory for output tracing.
  outputFileTracingRoot: join(appDir, '..', '..'),

  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
