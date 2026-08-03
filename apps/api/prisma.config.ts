import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * As of Prisma 7 the connection URL lives here rather than in
 * `schema.prisma`, and the CLI no longer loads `.env` for you. This file
 * configures the CLI only (`generate`, `migrate`, `studio`); the running
 * application connects through the `pg` driver adapter wired up in
 * `PrismaService`.
 */

// Node's built-in loader — no dotenv dependency. Resolves `.env` against the
// working directory, which is always `apps/api` because the Prisma CLI is
// invoked through this package's own scripts. A missing file is expected on a
// fresh clone and in CI, where variables are injected by the platform.
try {
  process.loadEnvFile();
} catch {
  // No local .env; fall through to the ambient environment.
}

/**
 * `prisma generate` reads the schema and never opens a connection, so it must
 * not require a real URL — otherwise a clean clone cannot type-check or build.
 * Commands that *do* connect (`migrate`, `studio`) fail loudly against this
 * placeholder, which is the correct outcome when DATABASE_URL is unset.
 */
const UNCONFIGURED_DATABASE_URL = 'postgresql://unset:unset@localhost:5432/unset';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? UNCONFIGURED_DATABASE_URL,
  },
});
