import type { AppEnvironment } from './environment.js';

/**
 * Outcome of a health probe.
 *
 * - `ok`       — the service and everything it depends on are usable.
 * - `degraded` — the service is up but a dependency is not; requests may fail.
 * - `down`     — the service cannot serve traffic.
 */
export type HealthStatus = 'ok' | 'degraded' | 'down';

/** Result of probing a single downstream dependency, such as the database. */
export interface DependencyHealth {
  readonly name: string;
  readonly status: HealthStatus;
  /** Round-trip time of the probe, in milliseconds. */
  readonly latencyMs: number;
  /** Present only when `status` is not `ok`. */
  readonly error?: string;
}

/**
 * The payload returned by the API's health endpoints.
 *
 * This is the contract Railway's health checks and any future status page read,
 * so it is defined once here rather than inside the API.
 */
export interface HealthReport {
  readonly status: HealthStatus;
  readonly environment: AppEnvironment;
  readonly version: string;
  /** ISO-8601 timestamp of when the report was produced. */
  readonly timestamp: string;
  /** Whole seconds the process has been running. */
  readonly uptimeSeconds: number;
  /** Empty for liveness probes; populated for readiness probes. */
  readonly dependencies: readonly DependencyHealth[];
}
