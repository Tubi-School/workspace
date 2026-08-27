import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RoleName } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../types.js';
import { RolesGuard } from './roles.guard.js';

function buildContext(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

function buildUser(role: RoleName): AuthenticatedUser {
  return { id: 'u1', email: 'x@example.com', fullName: 'X', role, isActive: true };
}

describe('RolesGuard', () => {
  it('allows access when the route declares no required roles', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(buildContext(buildUser(RoleName.LEARNER)))).toBe(true);
  });

  it('allows access when the user holds one of the required roles', () => {
    const reflector = {
      getAllAndOverride: () => [RoleName.ADMIN, RoleName.TEACHER],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(buildContext(buildUser(RoleName.TEACHER)))).toBe(true);
  });

  it('denies access when the user holds none of the required roles', () => {
    const reflector = { getAllAndOverride: () => [RoleName.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(buildContext(buildUser(RoleName.LEARNER)))).toThrow(ForbiddenException);
  });

  it('denies access when roles are required but there is no authenticated user', () => {
    const reflector = { getAllAndOverride: () => [RoleName.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(ForbiddenException);
  });
});
