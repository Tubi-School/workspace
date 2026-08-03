/**
 * Proves to the compiler that a union has been handled exhaustively.
 *
 * Call it in the `default` branch of a switch. If a new member is later added
 * to the union, the call stops type-checking and the build fails at the exact
 * place that needs updating — which is the point.
 *
 * @throws if it is somehow reached at runtime.
 */
export function assertNever(value: never, message = 'Unhandled union member'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
