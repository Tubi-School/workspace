import type { Server } from 'node:http';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { JWT_ALGORITHM } from './auth/jwt.constants.js';
import { JwtStrategy } from './auth/strategies/jwt.strategy.js';
import type { JwtPayload } from './auth/types.js';
import { CoursesController } from './courses/courses.controller.js';
import { CoursesService } from './courses/courses.service.js';
import { EntitlementService } from './entitlements/entitlement.service.js';
import { RoleName, type TeacherProfile, type User } from './generated/prisma/client.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { PrismaService } from './prisma/prisma.service.js';
import { MeetingProvisioningService } from './sessions/meeting-provisioning.service.js';
import { SessionsController } from './sessions/sessions.controller.js';
import { SessionsService } from './sessions/sessions.service.js';
import { TeacherPortalController } from './teacher-portal/teacher-portal.controller.js';
import { TeacherPortalService } from './teacher-portal/teacher-portal.service.js';
import { TeachersController } from './teachers/teachers.controller.js';
import { TeachersService } from './teachers/teachers.service.js';

/**
 * Proves the final Phase 3 security correction end-to-end: the broad
 * ADMIN-namespaced resource routes (courses, teachers, sessions) that
 * were previously `@Roles('ADMIN', 'TEACHER')` are now ADMIN-only, so a
 * TEACHER cannot bypass the server-side-scoped `/teacher/*` routes by
 * calling the old broad ones directly. ADMIN continues to succeed on the
 * broad routes, and the scoped `/teacher/*` routes continue to work for
 * TEACHER — this is a role-guard change, not a removal of teacher
 * capability.
 */
describe('Admin resource routes are ADMIN-only; teacher reads go through /teacher/*', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const TEST_JWT_SECRET = 'test-only-secret-not-used-anywhere-real';
  const now = new Date();

  const adminUser: User = {
    id: 'admin-1',
    email: 'admin@example.com',
    passwordHash: 'unused',
    role: RoleName.ADMIN,
    fullName: 'Admin One',
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

  const teacherProfile: TeacherProfile = {
    id: 'teacher-profile-1',
    userId: teacherUser.id,
    bio: null,
    createdAt: now,
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
          Promise.resolve([adminUser, teacherUser].find((u) => u.id === where.id) ?? null),
        ),
      },
      teacherProfile: {
        findUnique: jest.fn(({ where }: { where: { userId?: string; id?: string } }) => {
          if (where.userId) {
            return Promise.resolve(where.userId === teacherProfile.userId ? teacherProfile : null);
          }
          return Promise.resolve(where.id === teacherProfile.id ? teacherProfile : null);
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(teacherProfile),
        findMany: jest.fn().mockResolvedValue([teacherProfile]),
      },
      course: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      session: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const fakeConfigService = {
      getOrThrow: (key: string) => (key === 'JWT_SECRET' ? TEST_JWT_SECRET : '1h'),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: TEST_JWT_SECRET, signOptions: { algorithm: JWT_ALGORITHM } }),
      ],
      controllers: [
        CoursesController,
        TeachersController,
        SessionsController,
        TeacherPortalController,
      ],
      providers: [
        CoursesService,
        TeachersService,
        SessionsService,
        TeacherPortalService,
        JwtStrategy,
        { provide: PrismaService, useValue: fakePrisma },
        { provide: ConfigService, useValue: fakeConfigService },
        // SessionsService's constructor requires EntitlementService and
        // MeetingProvisioningService, but findAll/findOne (the only
        // methods this test exercises) never call either — bare stubs are
        // enough.
        {
          provide: EntitlementService,
          useValue: { evaluateForSession: jest.fn(), inheritForReplacement: jest.fn() },
        },
        {
          provide: MeetingProvisioningService,
          useValue: { provisionForSession: jest.fn(), releaseForCanceledSession: jest.fn() },
        },
        {
          provide: NotificationsService,
          useValue: {
            enqueue: jest.fn(),
            enqueueForEntitledLearners: jest.fn(),
            enqueueForAssignedTeachers: jest.fn(),
          },
        },
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

  describe('TEACHER receives 403 from the broad ADMIN routes', () => {
    it.each([
      ['GET', '/admin/courses'],
      ['GET', '/admin/teachers'],
      ['GET', '/admin/sessions'],
    ])('%s %s -> 403 for TEACHER', async (method, path) => {
      const token = await tokenFor(teacherUser);
      const response = await request(server())
        [method.toLowerCase() as 'get'](path)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    });
  });

  describe('ADMIN continues to succeed on the same broad routes', () => {
    it.each([
      ['GET', '/admin/courses'],
      ['GET', '/admin/teachers'],
      ['GET', '/admin/sessions'],
    ])('%s %s -> 200 for ADMIN', async (method, path) => {
      const token = await tokenFor(adminUser);
      const response = await request(server())
        [method.toLowerCase() as 'get'](path)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
    });
  });

  describe('the new scoped /teacher/* routes continue to work for TEACHER', () => {
    it('GET /teacher/me succeeds', async () => {
      const token = await tokenFor(teacherUser);
      const response = await request(server())
        .get('/teacher/me')
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(200);
    });

    it('GET /teacher/courses succeeds', async () => {
      const token = await tokenFor(teacherUser);
      const response = await request(server())
        .get('/teacher/courses')
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(200);
    });

    it('GET /teacher/sessions succeeds', async () => {
      const token = await tokenFor(teacherUser);
      const response = await request(server())
        .get('/teacher/sessions')
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(200);
    });
  });

  it('ADMIN is rejected from the TEACHER-only scoped routes (roles remain mutually exclusive, not additive)', async () => {
    const token = await tokenFor(adminUser);
    const response = await request(server())
      .get('/teacher/me')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
  });
});
