import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';

/**
 * The application's single Prisma Client, managed by the Nest lifecycle.
 *
 * Prisma 7 removed the bundled Rust query engine, so a driver adapter is now
 * mandatory. `@prisma/adapter-pg` speaks to PostgreSQL over `node-postgres`,
 * which works unchanged against both a local container and Neon.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService) {
    const connectionString = configService.getOrThrow<string>('DATABASE_URL');

    super({
      adapter: new PrismaPg({ connectionString }),
      log: ['warn', 'error'],
    });
  }

  /**
   * Verifies the database is actually reachable at boot, without making boot
   * depend on it.
   *
   * `$connect()` on a driver adapter is lazy — it returns successfully even
   * when the database is unreachable, so it proves nothing on its own. An
   * explicit query is the only honest check.
   *
   * A failure here is logged but not thrown. Crash-looping on a database blip
   * turns a brief dependency outage into a longer one; the readiness probe at
   * `/health/ready` is what keeps traffic away until PostgreSQL recovers.
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();

    try {
      await this.ping();
      this.logger.log('Connected to PostgreSQL');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(
        `PostgreSQL is not reachable (${reason}). ` +
          'The API will start but report not-ready until the connection succeeds.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Cheapest possible round-trip to the database.
   *
   * Used by the readiness probe; deliberately not a query against a model, so
   * it keeps working as the schema evolves.
   */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
