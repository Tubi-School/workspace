# Architecture

This document explains how TUBI Workspace is put together and, more importantly, **why**. It covers the decisions taken in Milestone M1, the engineering foundation.

---

## 1. Shape of the repository

Workspace is a single Turborepo monorepo containing two deployable applications and four shared packages.

```
apps/web  ──┐
            ├── packages/ui ──┐
apps/api  ──┤                 ├── (no dependencies on apps)
            ├── packages/types
            ├── packages/utils
            └── packages/config
```

**Why a monorepo.** The web client and the API share a type contract. In two repositories that contract is a copy-paste convention that silently rots; here it is a compile error. One `pnpm install`, one lint configuration, one CI pipeline, and atomic commits that change both sides of an interface together.

**Dependency direction is one-way.** Applications depend on packages; packages never depend on applications, and never on each other except through `@tubi/config`. This keeps the graph acyclic, which is what lets Turborepo parallelise and cache correctly.

---

## 2. Package manager and task runner

**pnpm** — chosen for its content-addressed store (fast, disk-efficient installs) and, more importantly, its _strict_ `node_modules` layout. A package can only import what it declares. During M1 this immediately caught two real missing dependencies that a hoisted layout would have masked until deployment.

**Turborepo** — task orchestration with a content-addressed cache. Every task declares its inputs and outputs in [`turbo.json`](../turbo.json), so unchanged work is never repeated.

The task graph:

| Task          | Depends on | Why                                                     |
| ------------- | ---------- | ------------------------------------------------------- |
| `build`       | `^build`   | A package must be compiled before its consumers compile |
| `typecheck`   | `^build`   | Type-checking reads dependencies' emitted `.d.ts` files |
| `lint`        | `^build`   | Type-aware lint rules need the same declarations        |
| `db:generate` | —          | Reads only the Prisma schema                            |

`@tubi/api`'s `build`, `typecheck` and `lint` additionally depend on `db:generate`, because the API imports generated TypeScript that must exist on disk first.

---

## 3. Module format: one format, deliberately

Shared packages are consumed by two very different compilers — the NestJS `tsc` build (CommonJS) and the Next.js bundler. Shipping dual ESM/CJS builds invites the dual-package hazard, where two copies of a module exist at runtime.

The rule adopted here:

- **`@tubi/types` and `@tubi/utils` are compiled to CommonJS** with declaration files. The API needs real JavaScript and `.d.ts` on disk; Next.js bundles CommonJS without complaint.
- **`@tubi/ui` ships TypeScript source**, listed in the web app's `transpilePackages`. It is only ever consumed by Next.js. Compiling it with `tsc` would risk stripping React Server Component directives such as `"use client"`, and it would cost the design system its fast refresh in development. Letting Next compile it makes the app's compiler the single source of truth for JSX.

This split is the one deliberate inconsistency in the repository, and it exists because the two kinds of package have genuinely different consumers.

---

## 4. Shared configuration

[`packages/config`](../packages/config) holds the TypeScript, ESLint and Prettier configuration. It is not compiled — it ships raw `.json` and `.mjs` files consumed through the package `exports` map.

**TypeScript** exposes five bases, each layering onto `base.json`:

| Base                 | Used by                      |
| -------------------- | ---------------------------- |
| `base.json`          | everything (strictness)      |
| `node-library.json`  | `@tubi/types`, `@tubi/utils` |
| `react-library.json` | `@tubi/ui`                   |
| `nextjs.json`        | `apps/web`                   |
| `nestjs.json`        | `apps/api`                   |

`base.json` turns on `strict` plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnusedLocals` and `noUnusedParameters`. Strictness is far cheaper to adopt on day one than to retrofit.

**ESLint** uses flat config with **type-aware** rules driven by the TypeScript project service. Rules such as `no-floating-promises` catch a class of async bug that syntax-only linting cannot see. Each package sets only `tsconfigRootDir`; everything else is inherited.

---

## 5. Version choices that are not "latest"

Two dependencies are deliberately held back. Both are noted here so the decision can be revisited rather than rediscovered.

### TypeScript 6.0.3, not 7.0.2

TypeScript 7 (the native port) is the current `latest`, but `typescript-eslint@8.65.0` declares `typescript >=4.8.4 <6.1.0`. Adopting TS 7 would mean giving up type-aware linting across the whole repository. TypeScript 6.0.3 is the newest stable release the entire toolchain supports.

**Revisit when:** `typescript-eslint` widens its peer range to TypeScript 7.

### ESLint 9.39.5, not 10.8.0

ESLint 10 was tested first and fails. `eslint-config-next@16.2.12` bundles `eslint-plugin-react@7.37.5`, `eslint-plugin-import@2.32.0` and `eslint-plugin-jsx-a11y@6.10.2`, none of which support ESLint 10. Two hard crashes result:

- `TypeError: contextOrFilename.getFilename is not a function` — `eslint-plugin-react` uses a context API that ESLint 10 removed.
- `TypeError: scopeManager.addGlobals is not a function` — ESLint 10 requires a scope-manager method the bundled parser does not implement.

These are upstream incompatibilities, not configuration errors. ESLint 9.39.5 is the newest version the Next.js lint stack supports.

**Revisit when:** `eslint-config-next` declares support for ESLint 10.

---

## 6. The API

A standard NestJS 11 application on Express.

**Configuration is validated at boot.** [`src/config/environment.ts`](../apps/api/src/config/environment.ts) parses `process.env` with a Zod schema wired into `ConfigModule.forRoot({ validate })`. A missing or malformed variable fails the deploy immediately with a readable message, rather than surfacing as `undefined` inside a request months later.

**Routes are versioned from day one.** A global `api/v1` prefix costs nothing now and avoids a coordinated migration of every client at the first breaking change. Health endpoints are excluded — probes should not have to know about API versions.

**Health checks are split into liveness and readiness.**

| Endpoint        | Checks               | Purpose                    |
| --------------- | -------------------- | -------------------------- |
| `/health`       | process only         | Is the container alive?    |
| `/health/ready` | process + PostgreSQL | Should it receive traffic? |

The distinction matters operationally. A liveness probe that fails because the database blipped causes the orchestrator to restart a perfectly healthy container, turning a brief dependency outage into a longer one.

---

## 7. Prisma 7

Prisma 7 changed two things that shape the setup here.

**The connection URL moved out of the schema.** `datasource { url = env(...) }` is rejected. The URL now lives in [`prisma.config.ts`](../apps/api/prisma.config.ts) for the CLI, and is passed to the client constructor at runtime.

**A driver adapter is mandatory.** The bundled Rust query engine is gone, so `PrismaClient` requires either a driver adapter or an Accelerate URL. Workspace uses `@prisma/adapter-pg` over `node-postgres`, which speaks to a local container and to Neon without any code change.

**The generated client must be CommonJS.** By default the `prisma-client` generator emits ESM using `import.meta.url` and `.ts` import specifiers, which a CommonJS NestJS build cannot load. The schema therefore sets `moduleFormat = "cjs"`, `generatedFileExtension = "ts"` and `importFileExtension = "js"`.

**Generated code lives in `src/generated/prisma`.** Prisma 7 emits TypeScript source rather than compiled JavaScript, so it must sit inside the Nest compiler's program. It is git-ignored, excluded from ESLint, and regenerated by `pnpm db:generate`.

**`prisma generate` must work without a database.** CI type-checks and builds before any database exists, so `prisma.config.ts` falls back to a placeholder URL when `DATABASE_URL` is unset. `generate`, `format`, and `validate` never open a connection, so they never need a real URL and never read `DIRECT_DATABASE_URL` (below) even if it happens to be set.

**The `migrate` command family uses a separate, direct connection.** Only `prisma migrate ...` (`deploy`, `dev`, `status`, ...) reads `DIRECT_DATABASE_URL` — never the pooled `DATABASE_URL` the running application uses. `migrate deploy`'s session-scoped advisory lock can hang indefinitely against a PgBouncer transaction-pooling connection (Neon's `-pooler` host), so `prisma.config.ts` requires the direct (non-pooler) URL for any `migrate` command. In production, a missing `DIRECT_DATABASE_URL` fails immediately and loudly, before any connection is attempted, rather than silently falling back to the pooled URL and risking that hang; outside production it falls back to `DATABASE_URL` so local `migrate dev` needs no second variable. This split also determines Railway's deploy shape: `prisma migrate deploy` runs as a pre-deploy step (before the container receives traffic), and the start command runs NestJS only — see `docs/deployment.md`.

The M1 schema declares no models. Domain models arrive with the milestones that need them.

---

## 8. The web client

Next.js 16 App Router, presentation-focused. Per the constitution, business logic belongs in the API.

**Tailwind CSS 4 is configured in CSS, not JavaScript.** There is no `tailwind.config.js`. The design tokens live in [`packages/ui/src/styles/theme.css`](../packages/ui/src/styles/theme.css) as a `@theme` block, which makes the design system — not the application — the source of truth for colour, type and radius.

Because `@tubi/ui` is compiled by Next rather than pre-built, the web app's stylesheet uses `@source` to point Tailwind at the design system's sources. Without it, utilities used only inside shared components would be missing from the production bundle.

**Dark mode re-points tokens rather than adding variants.** `@theme` declares the light palette; a `prefers-color-scheme` media query overrides the same custom properties on `:root`. Every utility built from a token switches automatically, so no component needs a `dark:` variant for its base appearance.

**No webfont is fetched at build time.** `next/font/google` was removed deliberately: it makes the production build depend on network access to Google's servers, a well-known source of flaky CI. Typography resolves through the `--font-sans` token to a locally installed Inter, falling back to the platform UI font.

---

## 9. What M1 deliberately does not include

- No authentication, dashboards, scheduling, assessments or HAPS.
- No domain models in the Prisma schema.
- **No test framework.** The milestone specifies a CI pipeline of install → lint → typecheck → build, and adding a test runner with no tests to run would be scaffolding for its own sake. This is the most significant known gap; see [development.md](development.md).
