# Deployment

TUBI Workspace deploys as two independent services against one managed database.

| Component  | Platform | Deploys from       |
| ---------- | -------- | ------------------ |
| `apps/web` | Vercel   | `apps/web`         |
| `apps/api` | Railway  | repository root    |
| Database   | Neon     | managed PostgreSQL |

Each milestone must leave the repository deployable. If `pnpm build` passes on a clean clone, both targets will build.

---

## Database — Neon

1. Create a Neon project and a database named `tubi_workspace`.
2. Copy the **pooled** connection string. It looks like:

   ```
   postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/tubi_workspace?sslmode=require
   ```

3. Set it as `DATABASE_URL` on the API service.
4. Copy the **direct** (non-pooled) connection string too, and set it as `DIRECT_DATABASE_URL` on the API service (see "Migrations" below).

Workspace connects through `@prisma/adapter-pg`, a standard `node-postgres` driver adapter. Nothing in the application is aware of the difference between Neon and the local Docker container — only `DATABASE_URL` changes.

Use the **pooled** endpoint (`DATABASE_URL`) for the running application, and the **direct** (unpooled) endpoint (`DIRECT_DATABASE_URL`) for `prisma migrate deploy`, which needs a session-level connection that a PgBouncer transaction-pooling connection cannot provide — a migration run against the pooled endpoint can hang indefinitely rather than fail, which is what motivated splitting the two variables (see "Migrations" below).

---

## API — Railway

Create a service pointing at the repository root (not `apps/api` — the build needs the workspace).

### Settings

| Setting      | Value                                   |
| ------------ | --------------------------------------- |
| Install      | `pnpm install --frozen-lockfile`        |
| Build        | `pnpm build`                            |
| Pre-deploy   | `pnpm --filter @tubi/api run db:deploy` |
| Start        | `pnpm --filter @tubi/api run start`     |
| Health check | `/health`                               |
| Watch paths  | `apps/api/**`, `packages/**`            |

`pnpm build` runs the whole Turborepo graph, which generates the Prisma Client and compiles the shared packages before the API — that ordering is declared in `turbo.json`, so nothing extra is needed. These are non-migration Prisma CLI operations (`generate`, `format`, `validate`) — they never read `DIRECT_DATABASE_URL`, so the build succeeds even when that variable is not yet set.

The pre-deploy and start commands are declared in `railway.json` (`deploy.preDeployCommand` and `deploy.startCommand`) and are deliberately separate steps — see "Migrations" below for why.

### Environment variables

| Variable              | Example                           | Notes                                                                                                                                |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`            | `production`                      | Required                                                                                                                             |
| `PORT`                | injected by Railway               | Do not set manually                                                                                                                  |
| `DATABASE_URL`        | Neon **pooled** connection string | Required — runtime application traffic only                                                                                          |
| `DIRECT_DATABASE_URL` | Neon **direct** connection string | Required in production for `prisma migrate deploy` — the Prisma CLI's migration commands only; never read by the running application |
| `CORS_ORIGINS`        | `https://workspace.tubi.school`   | Comma-separated; must include the Vercel URL                                                                                         |
| `APP_VERSION`         | `${{ RAILWAY_GIT_COMMIT_SHA }}`   | Reported by the health endpoints                                                                                                     |

The API validates its own runtime variables (`NODE_ENV`, `PORT`, `DATABASE_URL`, `CORS_ORIGINS`, `APP_VERSION`) at boot and refuses to start if any is missing or malformed. A failed deploy with a configuration error in the logs is intended behaviour.

`DIRECT_DATABASE_URL` is not an API runtime variable — the NestJS process never reads it and applies no validation to it. It is consumed and validated by the Prisma CLI, during Railway's pre-deploy step (`prisma migrate deploy`), before the API start command ever runs. In production, that pre-deploy step fails closed immediately if `DIRECT_DATABASE_URL` is absent — see "Migrations" below.

The server binds to `0.0.0.0` so Railway's health check can reach it, and `enableShutdownHooks()` closes the Prisma pool cleanly on SIGTERM during a redeploy.

### Migrations

Railway runs migrations as a **pre-deploy step**, before the new container is given traffic and before the start command runs — declared as `deploy.preDeployCommand` in `railway.json`:

```bash
pnpm --filter @tubi/api run db:deploy
```

This is intentionally NOT part of the start command. An earlier revision ran `prisma migrate deploy && node dist/main.js` as one start step; that meant the process could not bind to `PORT` and answer `/health` until migration had fully finished, and — because migration ran against the pooled `DATABASE_URL` — a session-scoped `migrate deploy` statement could hang indefinitely against the PgBouncer pooler with no error, silently failing Railway's healthcheck. The current start command (`pnpm --filter @tubi/api run start` → `node dist/main.js`) starts NestJS only and never runs a migration.

`prisma migrate deploy` uses `DIRECT_DATABASE_URL` (see `apps/api/prisma.config.ts`). In production, if `DIRECT_DATABASE_URL` is not set, the Prisma CLI fails immediately and clearly — before attempting any connection — rather than silently falling back to the pooled `DATABASE_URL` and risking the same hang this design eliminates. Outside production (local `migrate dev`), `DATABASE_URL` remains an acceptable fallback so a second variable is not required just to develop locally. Non-migration Prisma commands (`generate`, `format`, `validate`) never read `DIRECT_DATABASE_URL` at all, even if it is set.

Never run `prisma migrate dev` against production — it is a development command and can drop data.

---

## Web — Vercel

Import the repository and set the **Root Directory** to `apps/web`. Vercel detects both Next.js and the Turborepo layout and configures the build itself.

| Setting        | Value                            |
| -------------- | -------------------------------- |
| Framework      | Next.js (auto-detected)          |
| Root Directory | `apps/web`                       |
| Install        | `pnpm install --frozen-lockfile` |
| Build          | `pnpm build` (auto-detected)     |
| Node version   | 24                               |

### Environment variables

| Variable              | Example                   | Notes                           |
| --------------------- | ------------------------- | ------------------------------- |
| `NEXT_PUBLIC_API_URL` | `https://api.tubi.school` | Inlined into the browser bundle |

Anything prefixed `NEXT_PUBLIC_` is embedded in client-side JavaScript and is **public**. Never put a secret behind that prefix.

`outputFileTracingRoot` is set in `next.config.ts` so Next resolves the monorepo root correctly when tracing files for the serverless output.

---

## Order of operations

For a first deployment, and after any change to the database schema:

1. Provision or migrate the Neon database.
2. Deploy the API to Railway and confirm `/health/ready` returns `200`.
3. Deploy the web client to Vercel.
4. Add the Vercel production URL to `CORS_ORIGINS` on the API and redeploy it.

Step 4 is easy to forget: the browser will report an opaque CORS failure rather than anything that points at the cause.

---

## Verifying a deployment

```bash
curl -i https://api.tubi.school/health
curl -i https://api.tubi.school/health/ready
```

`/health` returns `200` whenever the process is running. `/health/ready` returns `200` only when PostgreSQL is also reachable, and `503` with a `dependencies` array describing the failure otherwise — that body is the fastest way to distinguish an application problem from a database problem.
