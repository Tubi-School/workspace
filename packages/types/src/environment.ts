/**
 * The deployment environment a process is running in.
 *
 * Shared rather than redeclared per app so that the API and the web client can
 * never drift on the set of legal values.
 */
export type AppEnvironment = 'development' | 'test' | 'production';
