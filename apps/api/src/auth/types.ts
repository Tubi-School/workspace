import type { RoleName } from '../generated/prisma/client.js';

/** Claims embedded in an issued access token. Kept minimal deliberately —
 * anything else about the user is looked up fresh per request so a change
 * (e.g. deactivation) takes effect without waiting for the token to expire. */
export interface JwtPayload {
  sub: string;
  email: string;
  role: RoleName;
}

/** The shape attached to `Request.user` once a token has been verified and
 * the corresponding user has been re-checked against the database. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: RoleName;
  isActive: boolean;
}

/** A `User` row with `passwordHash` removed. This is the only shape of user
 * data that may ever leave the process via an HTTP response. */
export type SanitizedUser = AuthenticatedUser & {
  createdAt: Date;
  updatedAt: Date;
};
