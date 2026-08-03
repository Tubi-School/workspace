import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service.js';

/**
 * Database access.
 *
 * Marked `@Global` because a connection pool is a process-wide resource:
 * feature modules should inject `PrismaService` without each having to import
 * this module, and there must only ever be one client.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
