import type { Server } from 'node:http';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { JWT_ALGORITHM } from '../auth/jwt.constants.js';
import { JwtStrategy } from '../auth/strategies/jwt.strategy.js';
import type { JwtPayload } from '../auth/types.js';
import { RoleName, type User } from '../generated/prisma/client.js';
import { LearnerPortalService } from '../learner-portal/learner-portal.service.js';
import { OfferingsService } from '../offerings/offerings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SubscriptionAccessService } from '../subscription-access/subscription-access.service.js';
import { PAYMENT_PROVIDER } from './payments.constants.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

/**
 * Proves the commercial layer's role boundary end-to-end (section Q):
 * only a LEARNER may initiate checkout or read the learner-facing
 * offering catalog; only an ADMIN may read the payments launch-console
 * list — real JwtAuthGuard/RolesGuard, only PrismaService/provider
 * replaced.
 */
describe('Payments RBAC', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const TEST_JWT_SECRET = 'test-only-secret-not-used-anywhere-real';
  const now = new Date();

  const learnerUser: User = {
    id: 'learner-user-1',
    email: 'learner@example.com',
    passwordHash: 'unused',
    role: RoleName.LEARNER,
    fullName: 'Learner One',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  const teacherUser: User = {
    id: 'teacher-user-1',
    email: 'teacher@example.com',
    passwordHash: 'unused',
    role: RoleName.TEACHER,
    fullName: 'Teacher One',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  const adminUser: User = {
    id: 'admin-user-1',
    email: 'admin@example.com',
    passwordHash: 'unused',
    role: RoleName.ADMIN,
    fullName: 'Admin One',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  function tokenFor(user: User): Promise<string> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    return jwtService.signAsync(payload);
  }

  function server(): Server {
    return app.getHttpServer() as Server;
  }

  beforeAll(async () => {
    jwtService = new JwtService({
      secret: TEST_JWT_SECRET,
      signOptions: { algorithm: JWT_ALGORITHM },
    });

    const fakePrisma = {
      user: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            [learnerUser, teacherUser, adminUser].find((u) => u.id === where.id) ?? null,
          ),
        ),
      },
      learnerProfile: {
        findUnique: jest.fn(({ where }: { where: { userId?: string; id?: string } }) => {
          if (where.userId === learnerUser.id) return Promise.resolve({ id: 'learner-profile-1' });
          return Promise.resolve(null);
        }),
      },
      offering: { findMany: jest.fn().mockResolvedValue([]) },
      paymentOrder: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const fakeConfigService = {
      getOrThrow: (key: string) => (key === 'JWT_SECRET' ? TEST_JWT_SECRET : '1h'),
    };
    const fakeProvider = { name: 'PAYSTACK', isConfigured: () => false };

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: TEST_JWT_SECRET, signOptions: { algorithm: JWT_ALGORITHM } }),
      ],
      controllers: [PaymentsController],
      providers: [
        PaymentsService,
        LearnerPortalService,
        OfferingsService,
        JwtStrategy,
        { provide: PrismaService, useValue: fakePrisma },
        { provide: ConfigService, useValue: fakeConfigService },
        { provide: PAYMENT_PROVIDER, useValue: fakeProvider },
        { provide: SubscriptionAccessService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an unauthenticated request for the offering catalog', async () => {
    const response = await request(server()).get('/learner/offerings');
    expect(response.status).toBe(401);
  });

  it('allows a LEARNER to read the offering catalog', async () => {
    const token = await tokenFor(learnerUser);
    const response = await request(server())
      .get('/learner/offerings')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
  });

  it('forbids a TEACHER from reading the learner offering catalog', async () => {
    const token = await tokenFor(teacherUser);
    const response = await request(server())
      .get('/learner/offerings')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
  });

  it('forbids a TEACHER from initiating checkout', async () => {
    const token = await tokenFor(teacherUser);
    const response = await request(server())
      .post('/learner/payments/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ offeringId: 'a2f0f4e0-0000-4000-8000-000000000000' });
    expect(response.status).toBe(403);
  });

  it('forbids a LEARNER from reading the ADMIN payments console', async () => {
    const token = await tokenFor(learnerUser);
    const response = await request(server())
      .get('/admin/payments')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
  });

  it('allows an ADMIN to read the payments console', async () => {
    const token = await tokenFor(adminUser);
    const response = await request(server())
      .get('/admin/payments')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
  });
});
