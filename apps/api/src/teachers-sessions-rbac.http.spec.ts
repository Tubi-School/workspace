import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { Global, Module, type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { JWT_ALGORITHM } from './auth/jwt.constants.js';
import { JwtStrategy } from './auth/strategies/jwt.strategy.js';
import type { JwtPayload } from './auth/types.js';
import { RoleName, SessionStatus, TeacherRole, type User } from './generated/prisma/client.js';
import { PrismaService } from './prisma/prisma.service.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { TeachersModule } from './teachers/teachers.module.js';

/**
 * Proves the Phase 2C RBAC infrastructure and the Phase 2E teacher/session
 * write paths work end-to-end against real controllers — real guards, real
 * strategy, real signed tokens, only PrismaService replaced by an
 * in-memory fake. Deep business-rule coverage (staffing invariants,
 * lifecycle transitions, replacement validation, cutoff derivation) lives
 * in sessions.service.spec.ts / teachers.service.spec.ts; this file
 * focuses on authorization behavior and a couple of full round trips.
 */
describe('Teachers + Sessions RBAC', () => {
  let app: INestApplication;

  const TEST_JWT_SECRET = 'test-only-secret-not-used-anywhere-real';
  const users = new Map<string, User>();
  let jwtService: JwtService;

  function seedUser(id: string, role: RoleName): User {
    const now = new Date();
    const user: User = {
      id,
      email: `${id}@example.com`,
      passwordHash: 'unused-in-this-suite',
      role,
      fullName: id,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    users.set(id, user);
    return user;
  }

  const admin = seedUser('admin-user', RoleName.ADMIN);
  const teacherCaller = seedUser('teacher-user', RoleName.TEACHER);
  const learner = seedUser('learner-user', RoleName.LEARNER);

  function tokenFor(user: User): Promise<string> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    return jwtService.signAsync(payload);
  }

  function server(): Server {
    return app.getHttpServer() as Server;
  }

  beforeAll(async () => {
    jwtService = new JwtService({ secret: TEST_JWT_SECRET, signOptions: { algorithm: JWT_ALGORITHM } });

    const teacherProfileId = randomUUID();
    const courseId = randomUUID();

    const fakePrisma = {
      user: {
        findUnique: jest.fn(({ where }: { where: { id?: string; email?: string } }) => {
          if (where.id) return Promise.resolve(users.get(where.id) ?? null);
          return Promise.resolve(null);
        }),
        create: jest.fn(({ data }: { data: Partial<User> }) => {
          const now = new Date();
          const user: User = {
            id: randomUUID(),
            email: data.email ?? '',
            passwordHash: data.passwordHash ?? '',
            fullName: data.fullName ?? '',
            role: data.role ?? RoleName.TEACHER,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          };
          users.set(user.id, user);
          return Promise.resolve(user);
        }),
      },
      teacherProfile: {
        create: jest.fn(({ data }: { data: { userId: string; bio: string | null } }) => {
          const user = users.get(data.userId);
          // Mirrors the real query's `include: { user: { select: {...} } }`
          // — a fake that returned the raw user (with passwordHash) would
          // let this test pass for the wrong reason.
          const safeUser = user
            ? {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                role: user.role,
                isActive: user.isActive,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
              }
            : null;
          return Promise.resolve({
            id: teacherProfileId,
            userId: data.userId,
            bio: data.bio,
            createdAt: new Date(),
            user: safeUser,
          });
        }),
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === teacherProfileId
              ? { id: teacherProfileId, bio: null, createdAt: new Date(), user: { isActive: true, role: RoleName.TEACHER } }
              : null,
          ),
        ),
        findMany: jest.fn(() => Promise.resolve([])),
      },
      course: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === courseId
              ? {
                  id: courseId,
                  primaryTeacherId: teacherProfileId,
                  academicTerm: { id: 'term-1', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
                }
              : null,
          ),
        ),
      },
      session: {
        create: jest.fn(
          ({
            data,
          }: {
            data: {
              courseId: string;
              sessionDate: Date;
              startTime: Date;
              endTime: Date;
              liveMeetingUrl: string;
              attendanceCutoffAt: Date;
              teachers: { create: { teacherId: string; teacherRole: TeacherRole }[] };
            };
          }) =>
            Promise.resolve({
              id: randomUUID(),
              ...data,
              status: SessionStatus.SCHEDULED,
              canceledAt: null,
              replacementForSessionId: null,
              course: { id: data.courseId },
              teachers: data.teachers.create.map((t) => ({ ...t, teacher: { id: t.teacherId } })),
            }),
        ),
        findMany: jest.fn(() => Promise.resolve([])),
      },
    };

    const fakePrismaWithTransaction = Object.assign(fakePrisma, {
      $transaction: jest.fn((fn: (tx: typeof fakePrisma) => Promise<unknown>) => fn(fakePrisma)),
    });

    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: fakePrismaWithTransaction }], exports: [PrismaService] })
    class FakePrismaModule {}

    const fakeConfigService = {
      getOrThrow: (key: string) => (key === 'JWT_SECRET' ? TEST_JWT_SECRET : '1h'),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        FakePrismaModule,
        JwtModule.register({ secret: TEST_JWT_SECRET, signOptions: { algorithm: JWT_ALGORITHM, expiresIn: '1h' } }),
        TeachersModule,
        SessionsModule,
      ],
      providers: [JwtStrategy, { provide: ConfigService, useValue: fakeConfigService }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    (app as unknown as { __courseId: string }).__courseId = courseId;
  });

  afterAll(async () => {
    await app.close();
  });

  function getCourseId(): string {
    return (app as unknown as { __courseId: string }).__courseId;
  }

  describe('unauthenticated access', () => {
    it('rejects teacher provisioning with no bearer token', async () => {
      const response = await request(server()).post('/admin/teachers').send({
        email: 'x@example.com',
        password: 'correct-horse-battery-staple',
        fullName: 'X',
      });
      expect(response.status).toBe(401);
    });

    it('rejects session creation with no bearer token', async () => {
      const response = await request(server()).post('/admin/sessions').send({});
      expect(response.status).toBe(401);
    });
  });

  describe('teacher provisioning authorization', () => {
    it('ADMIN can provision a teacher (User + TeacherProfile, role TEACHER, no passwordHash)', async () => {
      const token = await tokenFor(admin);
      const response = await request(server())
        .post('/admin/teachers')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'new.teacher@example.com', password: 'correct-horse-battery-staple', fullName: 'New Teacher' });

      expect(response.status).toBe(201);
      const body = response.body as { user?: { role?: string; passwordHash?: string } };
      expect(body.user?.role).toBe('TEACHER');
      expect(body.user).not.toHaveProperty('passwordHash');
      expect(response.body).not.toHaveProperty('passwordHash');
    });

    it('TEACHER cannot provision a teacher (403)', async () => {
      const token = await tokenFor(teacherCaller);
      const response = await request(server())
        .post('/admin/teachers')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'blocked@example.com', password: 'correct-horse-battery-staple', fullName: 'Blocked' });

      expect(response.status).toBe(403);
    });

    it('LEARNER cannot provision a teacher (403)', async () => {
      const token = await tokenFor(learner);
      const response = await request(server())
        .post('/admin/teachers')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'blocked2@example.com', password: 'correct-horse-battery-staple', fullName: 'Blocked' });

      expect(response.status).toBe(403);
    });

    it('TEACHER can read the teacher list', async () => {
      const token = await tokenFor(teacherCaller);
      const response = await request(server()).get('/admin/teachers').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
    });
  });

  describe('session creation authorization', () => {
    it('ADMIN can create a valid session with a derived attendance cutoff and defaulted PRIMARY', async () => {
      const token = await tokenFor(admin);
      const response = await request(server())
        .post('/admin/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          courseId: getCourseId(),
          sessionDate: '2026-07-01',
          startTime: '2026-07-01T11:00:00Z',
          endTime: '2026-07-01T12:00:00Z',
          liveMeetingUrl: 'https://example.com/meet',
        });

      expect(response.status).toBe(201);
      const body = response.body as { attendanceCutoffAt?: string; teachers?: { teacherRole: string }[] };
      expect(body.attendanceCutoffAt).toBe('2026-07-01T21:59:00.000Z');
      expect(body.teachers?.[0]?.teacherRole).toBe('PRIMARY');
    });

    it('TEACHER cannot create a session (403)', async () => {
      const token = await tokenFor(teacherCaller);
      const response = await request(server())
        .post('/admin/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          courseId: getCourseId(),
          sessionDate: '2026-07-01',
          startTime: '2026-07-01T11:00:00Z',
          endTime: '2026-07-01T12:00:00Z',
          liveMeetingUrl: 'https://example.com/meet',
        });

      expect(response.status).toBe(403);
    });

    it('LEARNER cannot create a session (403)', async () => {
      const token = await tokenFor(learner);
      const response = await request(server())
        .post('/admin/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          courseId: getCourseId(),
          sessionDate: '2026-07-01',
          startTime: '2026-07-01T11:00:00Z',
          endTime: '2026-07-01T12:00:00Z',
          liveMeetingUrl: 'https://example.com/meet',
        });

      expect(response.status).toBe(403);
    });

    it('rejects a malformed courseId with 400', async () => {
      const token = await tokenFor(admin);
      const response = await request(server()).post('/admin/sessions').set('Authorization', `Bearer ${token}`).send({
        courseId: 'not-a-uuid',
        sessionDate: '2026-07-01',
        startTime: '2026-07-01T11:00:00Z',
        endTime: '2026-07-01T12:00:00Z',
        liveMeetingUrl: 'https://example.com/meet',
      });

      expect(response.status).toBe(400);
    });

    it('rejects a syntactically valid but non-existent courseId with 404', async () => {
      const token = await tokenFor(admin);
      const response = await request(server()).post('/admin/sessions').set('Authorization', `Bearer ${token}`).send({
        courseId: randomUUID(),
        sessionDate: '2026-07-01',
        startTime: '2026-07-01T11:00:00Z',
        endTime: '2026-07-01T12:00:00Z',
        liveMeetingUrl: 'https://example.com/meet',
      });

      expect(response.status).toBe(404);
    });

    it('TEACHER can read the session list', async () => {
      const token = await tokenFor(teacherCaller);
      const response = await request(server()).get('/admin/sessions').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
    });

    it('LEARNER cannot read the session list', async () => {
      const token = await tokenFor(learner);
      const response = await request(server()).get('/admin/sessions').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    });
  });

  describe('primary-teacher reassignment authorization', () => {
    it('TEACHER cannot reassign a session PRIMARY teacher (403)', async () => {
      const token = await tokenFor(teacherCaller);
      const response = await request(server())
        .patch(`/admin/sessions/${randomUUID()}/primary-teacher`)
        .set('Authorization', `Bearer ${token}`)
        .send({ incomingTeacherId: randomUUID(), outgoingTeacherAction: 'BECOME_ASSISTANT' });

      expect(response.status).toBe(403);
    });

    it('LEARNER cannot reassign a session PRIMARY teacher (403)', async () => {
      const token = await tokenFor(learner);
      const response = await request(server())
        .patch(`/admin/sessions/${randomUUID()}/primary-teacher`)
        .set('Authorization', `Bearer ${token}`)
        .send({ incomingTeacherId: randomUUID(), outgoingTeacherAction: 'BECOME_ASSISTANT' });

      expect(response.status).toBe(403);
    });

    it('rejects an unauthenticated reassignment request (401)', async () => {
      const response = await request(server())
        .patch(`/admin/sessions/${randomUUID()}/primary-teacher`)
        .send({ incomingTeacherId: randomUUID(), outgoingTeacherAction: 'BECOME_ASSISTANT' });

      expect(response.status).toBe(401);
    });

    it('rejects a malformed outgoingTeacherAction with 400', async () => {
      const token = await tokenFor(admin);
      const response = await request(server())
        .patch(`/admin/sessions/${randomUUID()}/primary-teacher`)
        .set('Authorization', `Bearer ${token}`)
        .send({ incomingTeacherId: randomUUID(), outgoingTeacherAction: 'NOT_A_REAL_ACTION' });

      expect(response.status).toBe(400);
    });
  });
});
