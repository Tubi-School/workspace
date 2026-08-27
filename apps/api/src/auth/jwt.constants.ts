/**
 * The single JWT signing/verification algorithm this service uses.
 *
 * Pinned explicitly, rather than left to library defaults, so that neither
 * issuance nor verification can silently drift to a different algorithm —
 * and so a token crafted with an unacceptable algorithm is rejected instead
 * of accepted. `AuthModule` (signing) and `JwtStrategy` (verification) both
 * import this constant rather than each hardcoding their own literal.
 */
export const JWT_ALGORITHM = 'HS256';
