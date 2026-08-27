import { SetMetadata } from '@nestjs/common';
import type { RoleName } from '../../generated/prisma/client.js';

export const ROLES_KEY = 'roles';

/**
 * Declares which roles may access a route. Read by `RolesGuard`.
 *
 * `@Roles('ADMIN')`, `@Roles('ADMIN', 'TEACHER')`, etc. Always combine with
 * `@UseGuards(JwtAuthGuard, RolesGuard)` — this decorator alone enforces
 * nothing.
 */
export const Roles = (...roles: RoleName[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
