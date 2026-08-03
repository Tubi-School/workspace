import { Button } from '@tubi/ui';

/**
 * Placeholder shell for the workspace.
 *
 * M1 establishes the engineering foundation only. This page exists to prove
 * the full chain — Next.js, Tailwind, the design system and the shared
 * packages — compiles, renders and deploys. Product surfaces replace it.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
          TUBI Online School
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">Workspace</h1>
        <p className="text-muted-foreground max-w-prose text-base leading-relaxed">
          The operational platform for the school. Not a learning management system — a digital
          school.
        </p>
      </div>

      <div className="border-border bg-surface-raised flex flex-col gap-3 rounded-xl border p-5">
        <h2 className="text-sm font-semibold">Milestone M1 — engineering foundation</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          The monorepo, shared configuration, design system and continuous integration are in place.
          Product features are introduced from M2 onwards.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled>Sign in</Button>
        <Button variant="secondary" disabled>
          Documentation
        </Button>
        <span className="text-muted-foreground text-xs">Available in a later milestone.</span>
      </div>
    </main>
  );
}
