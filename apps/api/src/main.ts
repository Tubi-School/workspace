import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Sensible security headers by default; relaxing them later is a deliberate
  // act, whereas remembering to add them is easy to forget.
  app.use(helmet());

  app.enableCors({
    origin: config.getOrThrow<string[]>('corsOrigins'),
    credentials: true,
  });

  // All routes are versioned from day one so that the first breaking change
  // does not require a migration of every client at once. Health endpoints are
  // excluded — probes should not have to know about API versions.
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip properties the DTO does not declare, and reject requests that
      // send them, rather than silently ignoring unexpected input.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Lets Nest run `onModuleDestroy` / `onApplicationShutdown` when the platform
  // sends SIGTERM, so the Prisma pool closes cleanly on redeploy.
  app.enableShutdownHooks();

  const port = config.getOrThrow<number>('PORT');

  // Railway routes to the container's published port; binding to 0.0.0.0 is
  // required for the health check to reach the process.
  await app.listen(port, '0.0.0.0');

  logger.log(`API listening on http://0.0.0.0:${port}`);
}

void bootstrap();
