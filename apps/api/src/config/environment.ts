import { z } from 'zod';

/**
 * The shape of the API's runtime configuration.
 *
 * Validating at boot means a missing or malformed variable fails the deploy
 * immediately with a readable message, instead of surfacing as an undefined
 * value somewhere deep in a request months later.
 */
export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),

  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required — see apps/api/.env.example' })
    .min(1, 'DATABASE_URL is required — see apps/api/.env.example')
    .refine(
      (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'DATABASE_URL must be a PostgreSQL connection string',
    ),

  /** Comma-separated list; normalised into an array below. */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  APP_VERSION: z.string().default('0.0.0-dev'),

  /**
   * Signing secret for authentication JWTs. Required in every environment —
   * there is no safe default. A short/missing secret fails the deploy here
   * rather than issuing tokens an attacker can forge or brute-force.
   */
  JWT_SECRET: z
    .string({ error: 'JWT_SECRET is required — see apps/api/.env.example' })
    .min(32, 'JWT_SECRET must be at least 32 characters'),

  /** Passed straight to `jsonwebtoken` as the `expiresIn` option. */
  JWT_EXPIRES_IN: z.string().default('1d'),
});

export type RawEnvironment = z.infer<typeof environmentSchema>;

export interface AppConfig extends Omit<RawEnvironment, 'CORS_ORIGINS'> {
  readonly corsOrigins: readonly string[];
}

/**
 * Parses and normalises `process.env`.
 *
 * Passed to `ConfigModule.forRoot({ validate })`, so Nest refuses to start if
 * the environment is not viable.
 */
export function validateEnvironment(raw: Record<string, unknown>): AppConfig {
  const result = environmentSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const { CORS_ORIGINS, ...rest } = result.data;

  return {
    ...rest,
    corsOrigins: CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  };
}
