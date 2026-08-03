# TUBI Workspace

The operational platform for **TUBI Online School**.

Workspace runs the daily operation of the school. It is deliberately **not** a learning management system — it is a digital school: calm, fast and uncluttered, closer in feel to Linear or Notion than to Moodle.

Workspace does **not** contain HAPS, the adaptive learning engine. HAPS is a separate product and stays completely decoupled from this repository.

> **Status — Milestone M1: engineering foundation.**
> This repository currently contains the monorepo, shared configuration, design system and CI pipeline. There are no product features yet: no authentication, no dashboards, no scheduling, no assessments. Those arrive from M2 onwards.

---

## Technology stack

| Concern          | Choice                                            |
| ---------------- | ------------------------------------------------- |
| Monorepo         | Turborepo 2.10                                    |
| Package manager  | pnpm 10 (workspaces)                              |
| Language         | TypeScript 6.0                                    |
| Frontend         | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| Backend          | NestJS 11 (Express)                               |
| Database         | PostgreSQL 18, Prisma ORM 7                       |
| Managed database | Neon (production)                                 |
| Frontend hosting | Vercel                                            |
| Backend hosting  | Railway                                           |
| CI               | GitHub Actions                                    |

---

## Repository layout

```
.
├── apps/
│   ├── api/                 NestJS service — all business logic lives here
│   │   ├── prisma/          Database schema and migrations
│   │   └── src/
│   │       ├── config/      Environment parsing and validation
│   │       ├── health/      Liveness and readiness probes
│   │       └── prisma/      Prisma client lifecycle
│   └── web/                 Next.js client — presentation only
│       └── src/app/         App Router routes
│
├── packages/
│   ├── config/              Shared TypeScript, ESLint and Prettier configuration
│   ├── types/               Types shared across the API/web boundary
│   ├── ui/                  Design system: components and design tokens
│   └── utils/               Framework-agnostic helpers
│
├── docs/                    Architecture, development and deployment guides
├── scripts/                 Repository maintenance scripts
├── AI/                      Engineering constitution and agent instructions
├── PROMPTS/                 Milestone prompt templates
└── .github/workflows/       Continuous integration
```

The dependency direction is strictly one-way: `apps/*` depend on `packages/*`, and packages never depend on apps.

---

## Local development

### Prerequisites

- **Node.js 24** (see [.nvmrc](.nvmrc)) — `nvm use`
- **pnpm 10** — `corepack enable`
- **Docker** — for local PostgreSQL (or bring your own instance)

### First run

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL
docker compose up -d

# 3. Configure the applications
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 4. Generate the Prisma Client
pnpm db:generate

# 5. Start everything
pnpm dev
```

| Application | URL                                                                 |
| ----------- | ------------------------------------------------------------------- |
| Web         | http://localhost:3000                                               |
| API         | http://localhost:3001/api/v1                                        |
| Health      | http://localhost:3001/health and http://localhost:3001/health/ready |

### Commands

All commands run from the repository root and fan out through Turborepo.

| Command             | Description                                    |
| ------------------- | ---------------------------------------------- |
| `pnpm dev`          | Start every application in watch mode          |
| `pnpm build`        | Build every application and package            |
| `pnpm lint`         | Lint the whole workspace                       |
| `pnpm typecheck`    | Type-check the whole workspace                 |
| `pnpm format`       | Format with Prettier                           |
| `pnpm format:check` | Verify formatting without writing (used by CI) |
| `pnpm db:generate`  | Regenerate the Prisma Client from the schema   |
| `pnpm db:migrate`   | Create and apply a migration locally           |
| `pnpm db:studio`    | Open Prisma Studio                             |
| `pnpm clean`        | Remove all build output and `node_modules`     |

To target a single workspace, use a filter:

```bash
pnpm --filter @tubi/api dev
pnpm --filter @tubi/web build
```

---

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push to `main` and on every pull request. It installs dependencies with a frozen lockfile, generates the Prisma Client, then checks formatting, lints, type-checks and builds every application. The pipeline is designed to pass on a clean clone with no database available.

---

## Deployment targets

| Application | Platform | Notes                                                                   |
| ----------- | -------- | ----------------------------------------------------------------------- |
| `apps/web`  | Vercel   | Root directory `apps/web`; Vercel detects the Next.js app and Turborepo |
| `apps/api`  | Railway  | Build `pnpm build`, start `pnpm --filter @tubi/api start`               |
| Database    | Neon     | Serverless PostgreSQL; consumed through `DATABASE_URL`                  |

Full instructions, including required environment variables and health-check configuration, are in [docs/deployment.md](docs/deployment.md).

---

## Documentation

- [docs/architecture.md](docs/architecture.md) — how the monorepo fits together and why
- [docs/development.md](docs/development.md) — day-to-day workflow and conventions
- [docs/deployment.md](docs/deployment.md) — Vercel, Railway and Neon setup
- [AI/CLAUDE.md](AI/CLAUDE.md) — the engineering constitution
