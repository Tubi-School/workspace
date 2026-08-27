import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './auth/auth.module.js';
import { validateEnvironment } from './config/environment.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

/**
 * Composition root.
 *
 * Every feature milestone adds exactly one module here. Cross-cutting
 * infrastructure (configuration, database) is registered once and exposed
 * globally so feature modules stay focused on their own domain.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Nest will not boot if the environment is invalid.
      validate: validateEnvironment,
      // Loaded in order of precedence; real deployments inject variables
      // directly and have no .env file at all.
      envFilePath: ['.env.local', '.env'],
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
  ],
})
export class AppModule {}
