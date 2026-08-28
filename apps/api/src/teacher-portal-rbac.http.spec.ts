import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { JWT_ALGORITHM } from './auth/jwt.constants.js';
import { JwtStrategy } from './auth/strategies/jwt.strategy.js';
import type { JwtPayload } from './auth/types.js';
import {
  RoleName,
  type Course,
  type Session,
  type TeacherProfile,
  type User,
} from './generated/prisma/client.js';
import { PrismaService } from './prisma/prisma.service.js';
import { TeacherPortalController } from './teacher-portal/teacher-portal.controller.js';
import { TeacherPortalService } from './teacher-portal/teacher-portal.service.js';

/**
 * Proves Phase 3 external review Correction 1 end-to-end: an unrelated
 * teacher cannot obtain another teacher's scoped course/session data.
 * Real guards, real strategy, real signed tokens, real
 * TeacherPortalService — only PrismaService is faked, seeded with two
 * teachers who each own their own Course and are assigned to their own
 * Session, plus one Session/Course belonging entirely to the other
 * teacher.
 */
describe('Teacher portal RBAC — cross-teacher isolation', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const TEST_JWT_SECRET = 'test-only-secret-not-used-anywhere-real';

  const now = new Date();
  const userA: User = {
    id: 'user-a',
    email: 'teacher-a@example.com',
    passwordHash: 'unused',
    role: RoleName.TEACHER,
    fullName: 'Teacher A',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  const userB: User = {
    id: 'user-b',
    email: 'teacher-b@example.com',
    passwordHash: 'unused',
    role: RoleName.TEACHER,
    fullName: 'Teacher B',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  const teacherProfileA: TeacherProfile = {
    id: 'teacher-profile-a',
    userId: userA.id,
    bio: null,
    createdAt: now,
  };
  const teacherProfileB: TeacherProfile = {
    id: 'teacher-profile-b',
    userId: userB.id,
    bio: null,
    createdAt: now,
  };

  const courseA = {
    id: 'course-a',
    primaryTeacherId: teacherProfileA.id,
    title: 'A only',
  } as Course;
  const courseB = {
    id: 'course-b',
    primaryTeacherId: teacherProfileB.id,
    title: 'B only',
  } as Course;

  const sessionA = { id: randomUUID(), courseId: courseA.id } as Session;
  const sessionB = { id: randomUUID(), courseId: courseB.id } as Session;

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
          Promise.resolve([userA, userB].find((u) => u.id === where.id) ?? null),
        ),
      },
      teacherProfile: {
        findUnique: jest.fn(({ where }: { where: { userId: string } }) =>
          Promise.resolve(
            [teacherProfileA, teacherProfileB].find((t) => t.userId === where.userId) ?? null,
          ),
        ),
      },
      course: {
        findMany: jest.fn(({ where }: { where: { primaryTeacherId: string } }) =>
          Promise.resolve(
            [courseA, courseB].filter((c) => c.primaryTeacherId === where.primaryTeacherId),
          ),
        ),
      },
      session: {
        findMany: jest.fn(({ where }: { where: { teachers: { some: { teacherId: string } } } }) => {
          const teacherId = where.teachers.some.teacherId;
          if (teacherId === teacherProfileA.id) return Promise.resolve([sessionA]);
          if (teacherId === teacherProfileB.id) return Promise.resolve([sessionB]);
          return Promise.resolve([]);
        }),
        findFirst: jest.fn(
          ({ where }: { where: { id: string; teachers: { some: { teacherId: string } } } }) => {
            const allSessions = [sessionA, sessionB];
            const match = allSessions.find(
              (s) =>
                s.id === where.id &&
                ((where.teachers.some.teacherId === teacherProfileA.id && s.id === sessionA.id) ||
                  (where.teachers.some.teacherId === teacherProfileB.id && s.id === sessionB.id)),
            );
            return Promise.resolve(match ?? null);
          },
        ),
      },
    };

    const fakeConfigService = {
      getOrThrow: (key: string) => (key === 'JWT_SECRET' ? TEST_JWT_SECRET : '1h'),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: TEST_JWT_SECRET, signOptions: { algorithm: JWT_ALGORITHM } }),
      ],
      controllers: [TeacherPortalController],
      providers: [
        TeacherPortalService,
        JwtStrategy,
        { provide: PrismaService, useValue: fakePrisma },
        { provide: ConfigService, useValue: fakeConfigService },
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

  it('returns only teacher A own course when teacher A calls GET /teacher/courses', async () => {
    const token = await tokenFor(userA);

    const response = await request(server())
      .get('/teacher/courses')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const body = response.body as Course[];
    expect(body).toHaveLength(1);
    expect(body[0]!.id).toBe(courseA.id);
    expect(body.some((c) => c.id === courseB.id)).toBe(false);
  });

  it('returns only teacher B own course when teacher B calls GET /teacher/courses — never teacher A data', async () => {
    const token = await tokenFor(userB);

    const response = await request(server())
      .get('/teacher/courses')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const body = response.body as Course[];
    expect(body).toHaveLength(1);
    expect(body[0]!.id).toBe(courseB.id);
    expect(body.some((c) => c.id === courseA.id)).toBe(false);
  });

  it('returns only teacher A own session when teacher A calls GET /teacher/sessions', async () => {
    const token = await tokenFor(userA);

    const response = await request(server())
      .get('/teacher/sessions')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const body = response.body as Session[];
    expect(body).toHaveLength(1);
    expect(body[0]!.id).toBe(sessionA.id);
    expect(body.some((s) => s.id === sessionB.id)).toBe(false);
  });

  it('identity is derived from the JWT, not from any client-supplied parameter — the request carries no teacherId at all', async () => {
    const token = await tokenFor(userB);

    // Note there is no way for this request to name a teacherId — the
    // route takes none. Teacher B's own identity, and only their own
    // identity, decides what comes back.
    const response = await request(server())
      .get('/teacher/sessions')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect((response.body as Session[]).every((s) => s.id !== sessionA.id)).toBe(true);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await request(server()).get('/teacher/courses');
    expect(response.status).toBe(401);
  });

  it('teacher B cannot obtain teacher A own session detail by id — 404, not the session data', async () => {
    const token = await tokenFor(userB);

    const response = await request(server())
      .get(`/teacher/sessions/${sessionA.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });

  it('teacher A can obtain their own session detail by id', async () => {
    const token = await tokenFor(userA);

    const response = await request(server())
      .get(`/teacher/sessions/${sessionA.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect((response.body as Session).id).toBe(sessionA.id);
  });
});
