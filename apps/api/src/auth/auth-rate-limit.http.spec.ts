import type { Server } from 'node:http';

import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';

import { RoleName, type User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JWT_ALGORITHM } from './jwt.constants.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';

/**
 * Exercises the login rate limiter end-to-end: real ThrottlerGuard, real
 * AuthController.login's `@Throttle({ default: { limit: 5, ttl: 60_000 } })`
 * override (Phase 2G, "Auth Rate Limiting"). Everything else mirrors
 * auth.http.spec.ts's fake-Prisma pattern.
 */
describe('Auth login rate limiting', () => {
  let app: INestApplication;

  const TEST_JWT_SECRET = 'test-only-secret-not-used-anywhere-real';
  const PASSWORD = 'correct-horse-battery-staple';

  function server(): Server {
    return app.getHttpServer() as Server;
  }

  beforeEach(async () => {
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const now = new Date();
    const user: User = {
      id: 'user-1',
      email: 'throttle@example.com',
      passwordHash,
      role: RoleName.LEARNER,
      fullName: 'Throttle Target',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    const fakePrisma = {
      user: {
        findUnique: jest.fn(({ where }: { where: { email?: string } }) =>
          Promise.resolve(where.email === user.email ? user : null),
        ),
      },
    };

    const fakeConfigService = {
      getOrThrow: (key: string) => (key === 'JWT_SECRET' ? TEST_JWT_SECRET : '1h'),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: TEST_JWT_SECRET,
          signOptions: { algorithm: JWT_ALGORITHM, expiresIn: '1h' },
        }),
        // Same limit AuthController.login declares in production — a
        // real ThrottlerModule/ThrottlerGuard, not a stand-in.
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        JwtStrategy,
        { provide: PrismaService, useValue: fakePrisma },
        { provide: ConfigService, useValue: fakeConfigService },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows login attempts within the limit to succeed normally', async () => {
    const response = await request(server())
      .post('/auth/login')
      .send({ email: 'throttle@example.com', password: PASSWORD });

    expect(response.status).toBe(200);
  });

  it('throttles repeated login attempts past the configured limit with 429, without leaking whether the account exists', async () => {
    // AuthController.login is annotated with limit: 5 for the 'default'
    // throttler — the 6th request from the same client within the window
    // must be rejected before it ever reaches AuthService.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(server())
        .post('/auth/login')
        .send({ email: 'throttle@example.com', password: 'wrong-password' });
      expect(response.status).toBe(401);
    }

    const throttled = await request(server())
      .post('/auth/login')
      .send({ email: 'throttle@example.com', password: 'wrong-password' });

    expect(throttled.status).toBe(429);
    // The throttled response must not resemble a credentials response —
    // no enumeration signal beyond "you are being rate limited".
    expect(throttled.body).not.toHaveProperty('accessToken');
  });

  it('throttling applies per-request-window regardless of which credentials are sent (not an account-specific counter)', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server())
        .post('/auth/login')
        .send({ email: `nonexistent-${attempt}@example.com`, password: 'whatever' });
    }

    const throttled = await request(server())
      .post('/auth/login')
      .send({ email: 'yet-another@example.com', password: 'whatever' });

    expect(throttled.status).toBe(429);
  });
});
