import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../types.js';

/**
 * Extracts the authenticated user attached by `JwtAuthGuard`. Only valid on
 * routes guarded by `JwtAuthGuard` — elsewhere `request.user` is undefined.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    return request.user;
  },
);
