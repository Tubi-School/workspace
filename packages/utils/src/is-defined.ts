/**
 * Narrows out `null` and `undefined`.
 *
 * Useful as a filter predicate, where a bare `Boolean` would also discard
 * legitimate falsy values such as `0` and `''`.
 *
 * @example
 * const names = rows.map((row) => row.name).filter(isDefined);
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
