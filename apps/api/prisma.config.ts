import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * As of Prisma 7 the connection URL lives here rather than in
 * `schema.prisma`, and the CLI no longer loads `.env` for you. This file
 * configures the CLI only (`generate`, `migrate`, `studio`); the running
 * application connects through the `pg` driver adapter wired up in
 * `PrismaService`, which reads `DATABASE_URL` directly and is entirely
 * unaffected by this file.
 *
 * The `migrate` command family (`migrate deploy`, `migrate dev`, `migrate
 * status`, ...) uses `DIRECT_DATABASE_URL`, never the pooled `DATABASE_URL`
 * — `migrate deploy`'s advisory-lock/session-scoped statements can hang
 * indefinitely against a PgBouncer transaction-pooling connection (Neon's
 * `-pooler` host), which does not preserve session state between
 * statements. Every other CLI command (`generate`, `format`, `validate`,
 * `studio`) never opens this kind of session-scoped connection and never
 * even looks at `DIRECT_DATABASE_URL` — the two variables are strictly
 * scoped to what actually needs each one.
 *
 * In production (`NODE_ENV=production`, how Railway's pre-deploy step runs
 * this file) a missing `DIRECT_DATABASE_URL` is a fail-closed configuration
 * error, not a silent fallback: falling back to `DATABASE_URL` there would
 * transparently recreate the exact pooled-connection hang this hotfix
 * exists to eliminate, with no indication anything was wrong. Outside
 * production — a fresh clone, CI, or a local Postgres with no pooler in
 * front of it — `DATABASE_URL` remains a safe fallback so a second
 * variable is not required just to run `migrate dev` locally.
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
 * placeholder outside production, which is the correct outcome when neither
 * URL variable is set.
 */
const UNCONFIGURED_DATABASE_URL = 'postgresql://unset:unset@localhost:5432/unset';

/** `argv[2]` is the Prisma CLI subcommand (`generate`, `migrate`, `studio`,
 * `format`, `validate`, ...) — verified empirically: `prisma generate` and
 * `prisma migrate status` both put it there, ahead of any further
 * subcommand/flags (`migrate deploy`, `migrate dev`, etc.). Used to scope
 * the fail-closed production check to migration commands only, so
 * `prisma generate` — which never opens a connection and runs as part of
 * the ordinary Railway BUILD step, where `NODE_ENV=production` is already
 * set — is never blocked by a variable it does not need. */
const isMigrateCommand = process.argv[2] === 'migrate';

function resolveMigrationDatasourceUrl(): string {
  // DIRECT_DATABASE_URL is consulted ONLY for `migrate` commands — a
  // non-migrate command (generate, format, validate, studio) must never
  // resolve it, even if it happens to be set, so the two variables stay
  // strictly scoped to what actually needs each one.
  if (isMigrateCommand) {
    // Deliberately NOT declared in turbo.json's globalEnv: Railway's
    // pre-deploy step runs `pnpm --filter @tubi/api run db:deploy` directly
    // (outside Turbo entirely), and no cached Turbo task ever needs this
    // value — declaring it there would give every task an undeserved
    // dependency on a variable only the migration CLI reads.
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    const direct = process.env.DIRECT_DATABASE_URL;
    if (direct) {
      return direct;
    }

    if (process.env.NODE_ENV === 'production') {
      // Fail closed, immediately, before any connection is attempted, with
      // no secret value in the message — never fall back to the pooled
      // DATABASE_URL for a production `migrate` command (deploy, dev,
      // status, resolve, ...). Falling back here would transparently
      // recreate the exact pooled-connection hang this hotfix exists to
      // eliminate, with no indication anything was wrong.
      throw new Error(
        'DIRECT_DATABASE_URL is required in production for Prisma CLI "migrate" ' +
          'commands — refusing to fall back to the pooled DATABASE_URL, which can ' +
          "hang indefinitely against migrate deploy's session-scoped advisory " +
          'lock. Set DIRECT_DATABASE_URL to Neon\'s direct (non "-pooler") ' +
          'connection string in the Railway environment.',
      );
    }

    // Non-production `migrate` (e.g. local `migrate dev`): DATABASE_URL is
    // an acceptable fallback — local Postgres/most CI have no pooler in
    // front of them, so a second variable is not required there.
  }

  // Non-migrate command, or non-production migrate with no direct URL set:
  // DATABASE_URL or the inert placeholder, as appropriate. Non-migrate
  // commands never open the connection this fallback would otherwise risk
  // hanging, so the pooled URL is always safe here.
  return process.env.DATABASE_URL ?? UNCONFIGURED_DATABASE_URL;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: resolveMigrationDatasourceUrl(),
  },
});
