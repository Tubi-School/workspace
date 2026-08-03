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

Workspace connects through `@prisma/adapter-pg`, a standard `node-postgres` driver adapter. Nothing in the application is aware of the difference between Neon and the local Docker container — only `DATABASE_URL` changes.

Use the **pooled** endpoint for the running application and the **direct** (unpooled) endpoint for `prisma migrate deploy`, which needs a session-level connection.

---

## API — Railway

Create a service pointing at the repository root (not `apps/api` — the build needs the workspace).

### Settings

| Setting      | Value                            |
| ------------ | -------------------------------- |
| Install      | `pnpm install --frozen-lockfile` |
| Build        | `pnpm build`                     |
| Start        | `pnpm --filter @tubi/api start`  |
| Health check | `/health`                        |
| Watch paths  | `apps/api/**`, `packages/**`     |

`pnpm build` runs the whole Turborepo graph, which generates the Prisma Client and compiles the shared packages before the API — that ordering is declared in `turbo.json`, so nothing extra is needed.

### Environment variables

| Variable       | Example                         | Notes                                        |
| -------------- | ------------------------------- | -------------------------------------------- |
| `NODE_ENV`     | `production`                    | Required                                     |
| `PORT`         | injected by Railway             | Do not set manually                          |
| `DATABASE_URL` | Neon pooled connection string   | Required                                     |
| `CORS_ORIGINS` | `https://workspace.tubi.school` | Comma-separated; must include the Vercel URL |
| `APP_VERSION`  | `${{ RAILWAY_GIT_COMMIT_SHA }}` | Reported by the health endpoints             |

The API validates all of these at boot and refuses to start if any is missing or malformed. A failed deploy with a configuration error in the logs is intended behaviour.

The server binds to `0.0.0.0` so Railway's health check can reach it, and `enableShutdownHooks()` closes the Prisma pool cleanly on SIGTERM during a redeploy.

### Migrations

Run migrations as a release step, before the new version starts serving:

```bash
pnpm --filter @tubi/api run db:deploy
```

Use the **direct** Neon connection string for this command. Never run `prisma migrate dev` against production — it is a development command and can drop data.

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
