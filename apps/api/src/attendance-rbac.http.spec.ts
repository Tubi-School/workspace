import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { Global, Module, type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AttendanceModule } from './attendance/attendance.module.js';
import { JWT_ALGORITHM } from './auth/jwt.constants.js';
import { JwtStrategy } from './auth/strategies/jwt.strategy.js';
import type { JwtPayload } from './auth/types.js';
import { AttendanceStatus, RoleName, type User } from './generated/prisma/client.js';
import { LearnerPortalModule } from './learner-portal/learner-portal.module.js';
import { PrismaService } from './prisma/prisma.service.js';

/**
 * Proves the Phase 2F privacy/scoping rules end-to-end: a LEARNER sees only
 * their own entitled-session data, a TEACHER only sees attendance for
 * sessions they are actually assigned to, ADMIN has school-wide read
 * access, and manual override is ADMIN-only. Real guards/strategy/signed
 * tokens; only PrismaService is faked.
 */
describe('Attendance RBAC and privacy', () => {
  let app: INestApplication;

  const TEST_JWT_SECRET = 'test-only-secret-not-used-anywhere-real';
  let jwtService: JwtService;

  const users = new Map<string, User>();
  function seedUser(id: string, role: RoleName): User {
    const now = new Date();
    const user: User = {
      id,
      email: `${id}@example.com`,
      passwordHash: 'unused',
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
  const teacherAssignedUser = seedUser('teacher-assigned-user', RoleName.TEACHER);
  const teacherUnrelatedUser = seedUser('teacher-unrelated-user', RoleName.TEACHER);
  const learnerAUser = seedUser('learner-a-user', RoleName.LEARNER);
  const learnerBUser = seedUser('learner-b-user', RoleName.LEARNER);

  const SESSION_ID = randomUUID();
  const TEACHER_PROFILE_ASSIGNED = 'teacher-profile-assigned';
  const TEACHER_PROFILE_UNRELATED = 'teacher-profile-unrelated';
  const LEARNER_PROFILE_A = 'learner-profile-a';
  const LEARNER_PROFILE_B = 'learner-profile-b';
  const ATTENDANCE_RECORD_A = randomUUID();

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
          Promise.resolve(users.get(where.id) ?? null),
        ),
      },
      teacherProfile: {
        findUnique: jest.fn(({ where }: { where: { userId?: string } }) => {
          if (where.userId === teacherAssignedUser.id)
            return Promise.resolve({ id: TEACHER_PROFILE_ASSIGNED });
          if (where.userId === teacherUnrelatedUser.id)
            return Promise.resolve({ id: TEACHER_PROFILE_UNRELATED });
          return Promise.resolve(null);
        }),
      },
      sessionTeacher: {
        findUnique: jest.fn(
          ({ where }: { where: { sessionId_teacherId: { teacherId: string } } }) =>
            Promise.resolve(
              where.sessionId_teacherId.teacherId === TEACHER_PROFILE_ASSIGNED
                ? { teacherRole: 'PRIMARY' }
                : null,
            ),
        ),
      },
      learnerProfile: {
        findUnique: jest.fn(({ where }: { where: { userId?: string; id?: string } }) => {
          if (where.userId === learnerAUser.id) return Promise.resolve({ id: LEARNER_PROFILE_A });
          if (where.userId === learnerBUser.id) return Promise.resolve({ id: LEARNER_PROFILE_B });
          return Promise.resolve(null);
        }),
      },
      sessionEntitlementSnapshot: {
        findUnique: jest.fn(
          ({ where }: { where: { sessionId_learnerId: { learnerId: string } } }) =>
            Promise.resolve(
              where.sessionId_learnerId.learnerId === LEARNER_PROFILE_A
                ? { wasEntitled: true }
                : null,
            ),
        ),
      },
      attendanceRecord: {
        findUnique: jest.fn(
          ({ where }: { where: { sessionId_learnerId?: { learnerId: string }; id?: string } }) => {
            if (where.id !== undefined) {
              return Promise.resolve(
                where.id === ATTENDANCE_RECORD_A
                  ? {
                      id: ATTENDANCE_RECORD_A,
                      sessionId: SESSION_ID,
                      learnerId: LEARNER_PROFILE_A,
                      status: AttendanceStatus.PENDING,
                      completionMode: null,
                      completedAt: null,
                    }
                  : null,
              );
            }
            return Promise.resolve(
              where.sessionId_learnerId?.learnerId === LEARNER_PROFILE_A
                ? {
                    id: ATTENDANCE_RECORD_A,
                    sessionId: SESSION_ID,
                    learnerId: LEARNER_PROFILE_A,
                    status: AttendanceStatus.PENDING,
                    completionMode: null,
                    completedAt: null,
                  }
                : null,
            );
          },
        ),
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: ATTENDANCE_RECORD_A,
              sessionId: SESSION_ID,
              learnerId: LEARNER_PROFILE_A,
              status: AttendanceStatus.PENDING,
              completionMode: null,
              completedAt: null,
            },
          ]),
        ),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: ATTENDANCE_RECORD_A, ...data }),
        ),
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      attendanceOverride: { create: jest.fn(() => Promise.resolve({})) },
      liveAttendanceInterval: { findMany: jest.fn(() => Promise.resolve([])) },
      watchedInterval: { findMany: jest.fn(() => Promise.resolve([])) },
      sessionRecording: { findUnique: jest.fn(() => Promise.resolve(null)) },
      session: {
        findUniqueOrThrow: jest.fn(() =>
          Promise.resolve({
            startTime: new Date('2026-07-01T11:00:00Z'),
            endTime: new Date('2026-07-01T12:00:00Z'),
          }),
        ),
      },
      attendanceWindowException: { findFirst: jest.fn(() => Promise.resolve(null)) },
    };

    const fakePrismaWithTransaction = Object.assign(fakePrisma, {
      $transaction: jest.fn((fn: (tx: typeof fakePrisma) => Promise<unknown>) => fn(fakePrisma)),
    });

    @Global()
    @Module({
      providers: [{ provide: PrismaService, useValue: fakePrismaWithTransaction }],
      exports: [PrismaService],
    })
    class FakePrismaModule {}

    const fakeConfigService = {
      getOrThrow: (key: string) => (key === 'JWT_SECRET' ? TEST_JWT_SECRET : '1h'),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        FakePrismaModule,
        JwtModule.register({
          secret: TEST_JWT_SECRET,
          signOptions: { algorithm: JWT_ALGORITHM, expiresIn: '1h' },
        }),
        AttendanceModule,
        LearnerPortalModule,
      ],
      providers: [JwtStrategy, { provide: ConfigService, useValue: fakeConfigService }],
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

  it('LEARNER A can read their own entitled session attendance', async () => {
    const token = await tokenFor(learnerAUser);
    const response = await request(server())
      .get(`/learner/sessions/${SESSION_ID}/attendance`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  it('LEARNER B cannot read a session only LEARNER A is entitled to (404, not 403 — existence is not confirmed)', async () => {
    const token = await tokenFor(learnerBUser);
    const response = await request(server())
      .get(`/learner/sessions/${SESSION_ID}/attendance`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });

  it('the TEACHER assigned to the session can read its attendance', async () => {
    const token = await tokenFor(teacherAssignedUser);
    const response = await request(server())
      .get(`/teacher/attendance/sessions/${SESSION_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  it('a TEACHER not assigned to the session cannot read its attendance', async () => {
    const token = await tokenFor(teacherUnrelatedUser);
    const response = await request(server())
      .get(`/teacher/attendance/sessions/${SESSION_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('ADMIN has school-wide attendance read access', async () => {
    const token = await tokenFor(admin);
    const response = await request(server())
      .get(`/admin/attendance/sessions/${SESSION_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  describe('manual override is ADMIN-only', () => {
    const overrideBody = {
      newStatus: 'ABSENT',
      reason: 'Confirmed technical failure via support ticket #123',
    };

    it('ADMIN can perform a manual override', async () => {
      const token = await tokenFor(admin);
      const response = await request(server())
        .post(`/admin/attendance/${ATTENDANCE_RECORD_A}/override`)
        .set('Authorization', `Bearer ${token}`)
        .send(overrideBody);

      expect(response.status).toBe(200);
    });

    it('TEACHER cannot perform a manual override', async () => {
      const token = await tokenFor(teacherAssignedUser);
      const response = await request(server())
        .post(`/admin/attendance/${ATTENDANCE_RECORD_A}/override`)
        .set('Authorization', `Bearer ${token}`)
        .send(overrideBody);

      expect(response.status).toBe(403);
    });

    it('LEARNER cannot perform a manual override', async () => {
      const token = await tokenFor(learnerAUser);
      const response = await request(server())
        .post(`/admin/attendance/${ATTENDANCE_RECORD_A}/override`)
        .set('Authorization', `Bearer ${token}`)
        .send(overrideBody);

      expect(response.status).toBe(403);
    });

    it('rejects an override request with no reason', async () => {
      const token = await tokenFor(admin);
      const response = await request(server())
        .post(`/admin/attendance/${ATTENDANCE_RECORD_A}/override`)
        .set('Authorization', `Bearer ${token}`)
        .send({ newStatus: 'ABSENT' });

      expect(response.status).toBe(400);
    });
  });

  it('unauthenticated requests are rejected everywhere', async () => {
    const response = await request(server()).get(`/admin/attendance/sessions/${SESSION_ID}`);
    expect(response.status).toBe(401);
  });
});
