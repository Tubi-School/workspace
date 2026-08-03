# Development

Day-to-day workflow for TUBI Workspace.

---

## Prerequisites

| Tool    | Version | Install                               |
| ------- | ------- | ------------------------------------- |
| Node.js | 24      | `nvm use` (reads [.nvmrc](../.nvmrc)) |
| pnpm    | 10      | `corepack enable`                     |
| Docker  | any     | for the local PostgreSQL container    |

The root `preinstall` hook ([`scripts/check-node.mjs`](../scripts/check-node.mjs)) verifies both versions and refuses to install with npm or yarn. Mismatched toolchains are the most common cause of monorepo breakage, so it fails loudly and early.

---

## Getting started

```bash
pnpm install
docker compose up -d
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm db:generate
pnpm dev
```

`pnpm dev` starts both applications and puts the shared libraries into watch mode.

---

## Everyday commands

| Command             | What it does                                 |
| ------------------- | -------------------------------------------- |
| `pnpm dev`          | Everything in watch mode                     |
| `pnpm build`        | Build every application and package          |
| `pnpm lint`         | Lint the workspace (and the root `scripts/`) |
| `pnpm lint:fix`     | Lint and auto-fix                            |
| `pnpm typecheck`    | Type-check every workspace                   |
| `pnpm format`       | Format with Prettier                         |
| `pnpm format:check` | Verify formatting (what CI runs)             |
| `pnpm clean`        | Remove all build output and `node_modules`   |

Scope any command to one workspace with a filter:

```bash
pnpm --filter @tubi/api dev
pnpm --filter @tubi/web build
pnpm --filter @tubi/ui lint
```

### When things get strange

Turborepo caches aggressively and pnpm uses symlinks, so a corrupt tree is best reset rather than debugged:

```bash
pnpm clean --keep-deps   # build output only
pnpm clean && pnpm install
```

---

## Working with the database

The Prisma schema is [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma). It declares no models yet.

```bash
pnpm db:generate   # regenerate the client after editing the schema
pnpm db:migrate    # create and apply a migration locally
pnpm db:studio     # browse data
```

The generated client is written to `apps/api/src/generated/prisma`. It is **git-ignored and must never be edited or committed** — regenerate it instead. If the API fails to compile with missing-module errors after a fresh clone or a branch switch, `pnpm db:generate` is almost always the fix.

`pnpm db:generate` works without a running database. `db:migrate` and `db:studio` do not; start the container first.

---

## Adding a workspace

1. Create the directory under `apps/` or `packages/`. pnpm picks it up from [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) automatically.
2. Name it `@tubi/<name>`.
3. Extend the right shared TypeScript base from `@tubi/config/tsconfig/*`.
4. Add an `eslint.config.mjs` that re-exports the matching shared config and sets `tsconfigRootDir`.
5. Provide the standard scripts so Turborepo can orchestrate it: `build` (if it emits), `dev`, `lint`, `typecheck`.

Depend on another workspace with the `workspace:` protocol:

```json
{ "dependencies": { "@tubi/types": "workspace:*" } }
```

---

## Conventions

**TypeScript everywhere, strictly.** `strict` plus `noUncheckedIndexedAccess` and friends. Prefer `unknown` over `any`; `@typescript-eslint/no-explicit-any` is an error, not a warning.

**Business logic belongs in the API.** The web client renders and collects input. Anything that decides something belongs in `apps/api`.

**Shared types live in `@tubi/types`.** If the API and the web client both need to understand a shape, it goes there so the two can never drift.

**Comments explain why, not what.** The code already says what it does.

**Never commit generated code**, `.env` files, or build output.

---

## Dependency notes

Two versions are pinned below `latest` on purpose:

- **TypeScript 6.0.3** — TypeScript 7 is not yet supported by `typescript-eslint`.
- **ESLint 9.39.5** — ESLint 10 crashes the plugins bundled with `eslint-config-next`.

Both are explained in detail in [architecture.md](architecture.md#5-version-choices-that-are-not-latest). Please do not bump either without checking that the whole pipeline still passes.

pnpm 10 blocks dependency lifecycle scripts by default. Packages that legitimately need one are allow-listed under `onlyBuiltDependencies` in [`pnpm-workspace.yaml`](../pnpm-workspace.yaml). If a new dependency ships a native binary, add it there — otherwise it will fail at runtime with no install-time error.

---

## Known gap: no automated tests

M1 ships no test framework. This is a conscious scope decision, not an oversight — the milestone defines CI as install → lint → typecheck → build, and a test runner with nothing to run is scaffolding for its own sake.

It is nonetheless the most significant gap in the foundation. The recommended next step is Vitest for the packages and the API, plus `@nestjs/testing` for module-level tests, added as a `test` task in `turbo.json` and a step in the CI workflow at the start of M2 — before there is enough behaviour for the absence of tests to hurt.
