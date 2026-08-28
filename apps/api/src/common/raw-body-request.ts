import type { Request } from 'express';

/** A request carrying the raw bytes captured by main.ts's body-parser
 * `verify` hook — the shape every webhook controller reads its signed
 * payload from. */
export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}
