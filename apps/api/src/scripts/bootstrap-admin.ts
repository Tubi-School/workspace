import 'reflect-metadata';

import * as readline from 'node:readline';

import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { isEmail } from 'class-validator';

import { PrismaClient, RoleName } from '../generated/prisma/client.js';

/**
 * One-time operator CLI to create the first production ADMIN account.
 *
 * There is deliberately no in-application path to an ADMIN account: public
 * `POST /auth/register` hardcodes `role: LEARNER` (see `AuthService.register`)
 * and no endpoint accepts a caller-supplied role. This script exists because
 * that gap is intentional — an ADMIN account requires a human operator with
 * direct database access, not a network-reachable code path an attacker
 * could also reach.
 *
 * Usage (run from `apps/api` after `pnpm build`, with production
 * `DATABASE_URL` in the environment — e.g. via `railway run`):
 *
 *   node dist/scripts/bootstrap-admin.js --email admin@school.example --name "Founder Admin"
 *
 * The password is never a command-line argument (it would land in shell
 * history and be visible to other processes via `ps`). It is read either
 * from an interactive, unechoed terminal prompt (the default — safe to run
 * directly in a local terminal against `railway run`), or from the
 * ADMIN_BOOTSTRAP_PASSWORD environment variable for non-interactive
 * execution (set it immediately before running and unset it immediately
 * after; never write it to a file or commit it).
 *
 * Fails safely: if an ADMIN already exists, this refuses to create a
 * second one (reporting only the existing email, never a hash) unless
 * --allow-additional is explicitly passed. Every failure path here uses
 * `process.exitCode` and returns rather than throwing an uncaught error
 * that could dump a stack trace into logs.
 *
 * Concurrency: an operator could plausibly run this twice at once (a
 * retried command, two terminals, a flaky `railway run`). The existing-
 * ADMIN check and the insert are therefore serialized inside a single
 * Postgres transaction guarded by a transaction-scoped advisory lock
 * (`pg_advisory_xact_lock`) keyed to a fixed string — the same primitive
 * already used elsewhere in this codebase for check-then-write races (see
 * `apps/api/src/common/pg-advisory-lock.util.ts`). A second concurrent
 * invocation blocks until the first transaction commits or rolls back,
 * then re-runs its own check having genuinely observed the result — it
 * can never observe "no ADMIN exists" concurrently with another process
 * that is also about to create one. The lock is released automatically
 * when the transaction commits or rolls back, so this needs no manual
 * unlock and no schema change: it is a Postgres advisory lock, not a
 * table.
 */

const BCRYPT_SALT_ROUNDS = 12; // Keep in sync with apps/api/src/auth/auth.service.ts
const MIN_ADMIN_PASSWORD_LENGTH = 12;

/** Fixed advisory-lock key serializing concurrent bootstrap invocations —
 * see the "Concurrency" note above the file-level doc comment. Any fixed
 * string works; it only needs to be the same across every invocation of
 * this script (never reused as a lock key by unrelated code, to avoid
 * incidental contention). */
const BOOTSTRAP_ADMIN_LOCK_KEY = 'tubi:bootstrap-admin';

// Key codes compared numerically rather than as literal control-character
// string constants, which are easy to mangle silently when copied through
// an editor/terminal — a numeric comparison is unambiguous.
const KEY_CODE_LINE_FEED = 10;
const KEY_CODE_CARRIAGE_RETURN = 13;
const KEY_CODE_END_OF_TRANSMISSION = 4; // Ctrl+D
const KEY_CODE_INTERRUPT = 3; // Ctrl+C
const KEY_CODE_BACKSPACE = 8;
const KEY_CODE_DELETE = 127;

export interface ParsedArgs {
  email: string;
  fullName: string;
  allowAdditional: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs | null {
  let email: string | undefined;
  let fullName: string | undefined;
  let allowAdditional = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--email') {
      email = argv[i + 1];
      i += 1;
    } else if (arg === '--name') {
      fullName = argv[i + 1];
      i += 1;
    } else if (arg === '--allow-additional') {
      allowAdditional = true;
    }
  }

  if (!email || !fullName) {
    return null;
  }

  // Matches AuthService's normalizeEmail() exactly (trim + lowercase) —
  // without this, an ADMIN created here as "Admin@School.example" would be
  // stored with different casing than the normal login path looks up
  // ("admin@school.example"), making the account unable to log in.
  return { email: email.trim().toLowerCase(), fullName: fullName.trim(), allowAdditional };
}

/** Reads the password without echoing it to the terminal. Falls back to a
 * plain (still not argv/history-visible) prompt when stdin is not a TTY —
 * e.g. piped input in a non-interactive execution context. */
function promptForPassword(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(promptText, (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    process.stdout.write(promptText);
    const stdin = process.stdin;
    let input = '';

    const onData = (chunk: Buffer): void => {
      const code = chunk[0];

      const isEnter =
        code === KEY_CODE_LINE_FEED ||
        code === KEY_CODE_CARRIAGE_RETURN ||
        code === KEY_CODE_END_OF_TRANSMISSION;

      if (code === undefined || isEnter) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
        return;
      }

      if (code === KEY_CODE_INTERRUPT) {
        process.stdout.write('\n');
        process.exit(1);
      }

      if (code === KEY_CODE_BACKSPACE || code === KEY_CODE_DELETE) {
        input = input.slice(0, -1);
        return;
      }

      input += chunk.toString('utf8');
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function resolvePassword(): Promise<string> {
  // Deliberately not declared in turbo.json: this is a one-off operator
  // tool never invoked by a cached Turbo task, so no task should carry a
  // dependency on a variable only this script's operator sets by hand,
  // immediately before running it.
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const fromEnv = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (fromEnv) {
    return fromEnv;
  }
  const first = await promptForPassword('Admin password (input hidden): ');
  const second = await promptForPassword('Confirm password: ');
  if (first !== second) {
    throw new Error('Passwords did not match.');
  }
  return first;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(
      'Usage: node dist/scripts/bootstrap-admin.js --email <email> --name "<full name>" [--allow-additional]',
    );
    process.exitCode = 1;
    return;
  }

  const { email, fullName, allowAdditional } = parsed;

  if (!isEmail(email)) {
    console.error(`Not a valid email address: ${email}`);
    process.exitCode = 1;
    return;
  }
  if (fullName.length === 0) {
    console.error('--name must not be empty.');
    process.exitCode = 1;
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set — refusing to guess a database to write to.');
    process.exitCode = 1;
    return;
  }

  // Password acquisition/validation happens before any database work: it
  // is interactive human I/O with no reason to hold an advisory lock (or
  // any transaction) open while waiting on it.
  const password = await resolvePassword();
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    console.error(
      `Password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters for an ADMIN account.`,
    );
    process.exitCode = 1;
    return;
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Taking this lock BEFORE either read is what actually prevents the
      // race: two concurrent invocations cannot both pass the
      // existing-ADMIN check and then both insert. The second invocation
      // blocks here until the first transaction commits or rolls back,
      // then performs its own check against the now-current state — it
      // can never observe "no ADMIN exists" while another transaction is
      // also mid-flight toward creating one.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${BOOTSTRAP_ADMIN_LOCK_KEY})::bigint)`;

      const existingAdmin = await tx.user.findFirst({
        where: { role: RoleName.ADMIN },
        select: { email: true },
      });
      if (existingAdmin && !allowAdditional) {
        return { outcome: 'admin-exists' as const, existingEmail: existingAdmin.email };
      }

      const emailInUse = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (emailInUse) {
        return { outcome: 'email-in-use' as const };
      }

      const created = await tx.user.create({
        data: { email, passwordHash, fullName, role: RoleName.ADMIN, isActive: true },
        select: { id: true, email: true, createdAt: true },
      });
      return { outcome: 'created' as const, created };
    });

    switch (result.outcome) {
      case 'admin-exists':
        console.error(
          `An ADMIN account already exists (${result.existingEmail}). Refusing to create ` +
            'another without --allow-additional. This is a safety default, not a hard limit ' +
            '— pass --allow-additional if a second ADMIN is genuinely intended.',
        );
        process.exitCode = 1;
        return;
      case 'email-in-use':
        console.error(
          `A user with email ${email} already exists (any role) — choose a different email.`,
        );
        process.exitCode = 1;
        return;
      case 'created':
        console.log(
          `Created ADMIN user ${result.created.email} (id: ${result.created.id}) at ` +
            `${result.created.createdAt.toISOString()}.`,
        );
        return;
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Only runs the CLI when this file is the process entry point — importing
// `parseArgs` from a test must never trigger a real database connection.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Admin bootstrap failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
