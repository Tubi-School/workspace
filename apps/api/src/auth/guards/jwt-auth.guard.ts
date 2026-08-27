import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Requires a valid bearer token. Attaches the re-checked user to
 * `request.user` (see `JwtStrategy.validate`) for `@CurrentUser()` and
 * `RolesGuard` to consume.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
