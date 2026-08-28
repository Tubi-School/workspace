import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  // Body parsing is disabled here and re-applied explicitly below with a
  // `verify` hook that stashes the exact raw bytes on the request. Zoom and
  // payment-provider webhook signatures are computed over the raw request
  // body — re-serializing the parsed JSON is not guaranteed byte-identical
  // and would make signature verification unreliable (see
  // webhooks/*.controller.ts).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.use(
    json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = buf;
      },
    }),
  );
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Railway (and any conventional PaaS reverse proxy) terminates TLS and
  // forwards the real client IP via X-Forwarded-For. Without this, every
  // request appears to originate from the proxy's own address, which
  // would make the login rate limiter (see auth.controller.ts) count all
  // callers as one client instead of limiting each caller individually.
  app.set('trust proxy', 1);

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
