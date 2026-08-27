import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { Global, Module, type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AcademicTermsModule } from './academic-terms/academic-terms.module.js';
import { JWT_ALGORITHM } from './auth/jwt.constants.js';
import { JwtStrategy } from './auth/strategies/jwt.strategy.js';
import type { JwtPayload } from './auth/types.js';
import { CoursesModule } from './courses/courses.module.js';
import { RoleName, type User } from './generated/prisma/client.js';
import { GradeLevelsModule } from './grade-levels/grade-levels.module.js';
import { PrismaService } from './prisma/prisma.service.js';
import { SubjectsModule } from './subjects/subjects.module.js';

/**
 * Proves the Phase 2C RBAC infrastructure (JwtAuthGuard, RolesGuard,
 * @Roles) works end-to-end against real Phase 2D controllers — not just
 * against the auth module that introduced it. Business-rule depth (unique
 * names, date-range validation, FK existence, delete safety) is covered by
 * each feature's own *.service.spec.ts; this file focuses on
 * authentication/authorization behavior and DTO validation, exercised
 * through one representative endpoint per resource plus a full round trip
 * for the most complex one (Course).
 */
describe('Admin academic-structure RBAC', () => {
  let app: INestApplication;

  const TEST_JWT_SECRET = 'test-only-secret-not-used-anywhere-real';
  const users = new Map<string, User>();

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
  const teacher = seedUser('teacher-user', RoleName.TEACHER);
  const learner = seedUser('learner-user', RoleName.LEARNER);

  let jwtService: JwtService;
  /** Exposed so individual tests can override a single call's resolution
   * (e.g. simulating a syntactically valid UUID that matches no row). */
  let teacherProfileFindUnique: jest.Mock;

  function tokenFor(user: User): Promise<string> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    return jwtService.signAsync(payload);
  }

  function server(): Server {
    return app.getHttpServer() as Server;
  }

  beforeAll(async () => {
    jwtService = new JwtService({ secret: TEST_JWT_SECRET, signOptions: { algorithm: JWT_ALGORITHM } });

    const fakePrisma = {
      user: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve(users.get(where.id) ?? null)),
      },
      gradeLevel: {
        // Called with { where: { name } } for the duplicate-name pre-check
        // (no existing row, by design of this suite) and with
        // { where: { id } } for Course's foreign-key existence check
        // (must resolve, so Course creation can succeed).
        findUnique: jest.fn(({ where }: { where: { id?: string; name?: string } }) =>
          Promise.resolve(where.id ? { id: where.id, name: 'Grade 8' } : null),
        ),
        findMany: jest.fn(() => Promise.resolve([])),
        create: jest.fn(({ data }: { data: { name: string } }) =>
          Promise.resolve({ id: 'grade-1', name: data.name }),
        ),
      },
      subject: {
        findUnique: jest.fn(({ where }: { where: { id?: string; name?: string } }) =>
          Promise.resolve(where.id ? { id: where.id, name: 'Mathematics' } : null),
        ),
        findMany: jest.fn(() => Promise.resolve([])),
        create: jest.fn(({ data }: { data: { name: string } }) =>
          Promise.resolve({ id: 'subject-1', name: data.name }),
        ),
      },
      academicTerm: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, name: '2026 Term 3' }),
        ),
        findMany: jest.fn(() => Promise.resolve([])),
        create: jest.fn(
          ({ data }: { data: { name: string; startDate: Date; endDate: Date; timezone?: string } }) =>
            Promise.resolve({
              id: 'term-1',
              name: data.name,
              startDate: data.startDate,
              endDate: data.endDate,
              timezone: data.timezone ?? 'Africa/Johannesburg',
            }),
        ),
      },
      teacherProfile: {
        findUnique: (teacherProfileFindUnique = jest.fn(() =>
          Promise.resolve({ id: 'teacher-profile-1', bio: null, createdAt: new Date() }),
        )),
      },
      course: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        findMany: jest.fn(() => Promise.resolve([])),
        create: jest.fn(
          ({ data }: { data: { title: string; subjectId: string; gradeLevelId: string; academicTermId: string; primaryTeacherId: string } }) =>
            Promise.resolve({
              id: 'course-1',
              title: data.title,
              subject: { id: data.subjectId, name: 'Mathematics' },
              gradeLevel: { id: data.gradeLevelId, name: 'Grade 8' },
              academicTerm: { id: data.academicTermId, name: '2026 Term 3' },
              primaryTeacher: { id: data.primaryTeacherId, bio: null, createdAt: new Date(), userId: 'teacher-1' },
            }),
        ),
      },
    };

    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: fakePrisma }], exports: [PrismaService] })
    class FakePrismaModule {}

    const fakeConfigService = {
      getOrThrow: (key: string) => (key === 'JWT_SECRET' ? TEST_JWT_SECRET : '1h'),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        FakePrismaModule,
        JwtModule.register({ secret: TEST_JWT_SECRET, signOptions: { algorithm: JWT_ALGORITHM, expiresIn: '1h' } }),
        GradeLevelsModule,
        SubjectsModule,
        AcademicTermsModule,
        CoursesModule,
      ],
      providers: [JwtStrategy, { provide: ConfigService, useValue: fakeConfigService }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('unauthenticated access', () => {
    it('rejects a read request with no bearer token', async () => {
      const response = await request(server()).get('/admin/grade-levels');
      expect(response.status).toBe(401);
    });

    it('rejects a write request with no bearer token', async () => {
      const response = await request(server()).post('/admin/grade-levels').send({ name: 'Grade 9' });
      expect(response.status).toBe(401);
    });
  });

  describe('ADMIN can create each academic-structure entity', () => {
    it('creates a GradeLevel', async () => {
      const token = await tokenFor(admin);
      const response = await request(server())
        .post('/admin/grade-levels')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Grade 8' });

      expect(response.status).toBe(201);
    });

    it('creates a Subject', async () => {
      const token = await tokenFor(admin);
      const response = await request(server())
        .post('/admin/subjects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Mathematics' });

      expect(response.status).toBe(201);
    });

    it('creates an AcademicTerm', async () => {
      const token = await tokenFor(admin);
      const response = await request(server())
        .post('/admin/academic-terms')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '2026 Term 3', startDate: '2026-07-01', endDate: '2026-09-30' });

      expect(response.status).toBe(201);
    });

    it('creates a Course, with every referenced entity resolved', async () => {
      const token = await tokenFor(admin);
      const response = await request(server())
        .post('/admin/courses')
        .set('Authorization', `Bearer ${token}`)
        .send({
          subjectId: randomUUID(),
          gradeLevelId: randomUUID(),
          academicTermId: randomUUID(),
          primaryTeacherId: randomUUID(),
          title: 'Grade 8 Mathematics',
        });

      expect(response.status).toBe(201);
      expect((response.body as { title?: string }).title).toBe('Grade 8 Mathematics');
    });
  });

  describe('TEACHER cannot mutate academic structure', () => {
    it('is forbidden from creating a GradeLevel', async () => {
      const token = await tokenFor(teacher);
      const response = await request(server())
        .post('/admin/grade-levels')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Grade 10' });

      expect(response.status).toBe(403);
    });

    it('is allowed to read GradeLevels', async () => {
      const token = await tokenFor(teacher);
      const response = await request(server()).get('/admin/grade-levels').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
    });
  });

  describe('LEARNER cannot mutate or read academic-structure admin routes', () => {
    it('is forbidden from creating a GradeLevel', async () => {
      const token = await tokenFor(learner);
      const response = await request(server())
        .post('/admin/grade-levels')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Grade 11' });

      expect(response.status).toBe(403);
    });

    it('is forbidden from reading GradeLevels', async () => {
      const token = await tokenFor(learner);
      const response = await request(server()).get('/admin/grade-levels').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    });
  });

  describe('ADMIN is allowed on permitted read endpoints', () => {
    it('reads the Subject list', async () => {
      const token = await tokenFor(admin);
      const response = await request(server()).get('/admin/subjects').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
    });
  });

  describe('DTO validation', () => {
    it('rejects a request body containing an unrecognised field', async () => {
      const token = await tokenFor(admin);
      const response = await request(server())
        .post('/admin/grade-levels')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Grade 8', isSecretlyAdmin: true });

      expect(response.status).toBe(400);
    });

    it('rejects an empty name', async () => {
      const token = await tokenFor(admin);
      const response = await request(server())
        .post('/admin/grade-levels')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '' });

      expect(response.status).toBe(400);
    });

    it('rejects a Course create with a malformed (non-UUID) reference — 400, not 404', async () => {
      const token = await tokenFor(admin);
      const response = await request(server())
        .post('/admin/courses')
        .set('Authorization', `Bearer ${token}`)
        .send({
          subjectId: 'not-a-uuid',
          gradeLevelId: randomUUID(),
          academicTermId: randomUUID(),
          primaryTeacherId: randomUUID(),
          title: 'Course',
        });

      expect(response.status).toBe(400);
    });

    it('rejects a Course create with a syntactically valid UUID that matches no teacher — 404, not 400', async () => {
      teacherProfileFindUnique.mockResolvedValueOnce(null);

      const token = await tokenFor(admin);
      const response = await request(server())
        .post('/admin/courses')
        .set('Authorization', `Bearer ${token}`)
        .send({
          subjectId: randomUUID(),
          gradeLevelId: randomUUID(),
          academicTermId: randomUUID(),
          primaryTeacherId: randomUUID(),
          title: 'Course',
        });

      expect(response.status).toBe(404);
      expect((response.body as { message?: string[] }).message?.[0]).toContain('primaryTeacherId');
    });
  });
});
