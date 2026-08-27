/**
 * Base URL of the TUBI Workspace API, read from environment configuration
 * rather than hardcoded — the production connectivity foundation Phase 2G
 * establishes for the frontend milestone that consumes this API next.
 *
 * `NEXT_PUBLIC_*` variables are inlined into the browser bundle at build
 * time, so `apps/web`'s own build (Vercel or local) must set
 * NEXT_PUBLIC_API_URL to the deployed Railway API's public URL in
 * production, and to the local API's URL in development — never a
 * hardcoded `localhost` value baked into shipped code.
 */
export const API_BASE_URL: string = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
