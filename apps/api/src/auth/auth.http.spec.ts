import type { Server } from 'node:http';

import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';

import { RoleName, type User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JWT_ALGORITHM } from './jwt.constants.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';

/** Shape of the JSON bodies this suite asserts against. Supertest types
 * `Response.body` as `any`; casting through this interface at the point of
 * use is what keeps the assertions themselves type-safe. */
interface AuthResponseBody {
  role?: string;
  email?: string;
  accessToken?: string;
  user?: { email?: string };
}

/**
 * Exercises the auth HTTP surface end-to-end against a real Nest application
 * — real controller, real guard, real strategy, real JWT signing/verification
 * — with only PrismaService replaced by an in-memory fake. This is what
 * proves the guard, decorator and strategy actually wire together, which the
 * unit-level AuthService tests cannot show on their own.
 */
describe('Auth HTTP surface', () => {
  let app: INestApplication;
  let users: Map<string, User>;

  const TEST_JWT_SECRET = 'test-only-secret-not-used-anywhere-real';

  function buildUser(overrides: Partial<User> = {}): User {
    const now = new Date();
    return {
      id: overrides.id ?? `user-${users.size + 1}`,
      email: 'seed@example.com',
      passwordHash: 'unset',
      role: RoleName.LEARNER,
      fullName: 'Seed User',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  /** `app.getHttpServer()` is typed loosely by Nest; supertest needs a
   * concrete `http.Server`. Centralising the cast here keeps it out of every
   * call site below. */
  function server(): Server {
    return app.getHttpServer() as Server;
  }

  function bodyOf(response: request.Response): AuthResponseBody {
    return response.body as AuthResponseBody;
  }

  beforeEach(async () => {
    users = new Map();

    const fakePrisma = {
      user: {
        findUnique: jest.fn(({ where }: { where: { id?: string; email?: string } }) => {
          if (where.id) return Promise.resolve(users.get(where.id) ?? null);
          const found = [...users.values()].find((u) => u.email === where.email);
          return Promise.resolve(found ?? null);
        }),
        create: jest.fn(({ data }: { data: Partial<User> }) => {
          const user = buildUser({ ...data, id: `user-${users.size + 1}` });
          users.set(user.id, user);
          return Promise.resolve(user);
        }),
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
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        JwtStrategy,
        { provide: PrismaService, useValue: fakePrisma },
        { provide: ConfigService, useValue: fakeConfigService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('registers a new learner and never returns passwordHash', async () => {
    const response = await request(server()).post('/auth/register').send({
      email: 'learner@example.com',
      password: 'correct-horse-battery-staple',
      fullName: 'Learner One',
    });

    expect(response.status).toBe(201);
    expect(bodyOf(response).role).toBe('LEARNER');
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('rejects registering an email that already exists', async () => {
    await request(server()).post('/auth/register').send({
      email: 'dup@example.com',
      password: 'correct-horse-battery-staple',
      fullName: 'First',
    });

    const second = await request(server()).post('/auth/register').send({
      email: 'dup@example.com',
      password: 'another-password-1',
      fullName: 'Second',
    });

    expect(second.status).toBe(409);
  });

  it('logs in with correct credentials and returns a usable bearer token', async () => {
    await request(server()).post('/auth/register').send({
      email: 'learner2@example.com',
      password: 'correct-horse-battery-staple',
      fullName: 'Learner Two',
    });

    const response = await request(server())
      .post('/auth/login')
      .send({ email: 'learner2@example.com', password: 'correct-horse-battery-staple' });

    expect(response.status).toBe(200);
    expect(typeof bodyOf(response).accessToken).toBe('string');
    expect(bodyOf(response).user).not.toHaveProperty('passwordHash');
  });

  it('rejects login with an incorrect password', async () => {
    await request(server()).post('/auth/register').send({
      email: 'learner3@example.com',
      password: 'correct-horse-battery-staple',
      fullName: 'Learner Three',
    });

    const response = await request(server())
      .post('/auth/login')
      .send({ email: 'learner3@example.com', password: 'wrong-password' });

    expect(response.status).toBe(401);
  });

  it('rejects login for a deactivated account', async () => {
    const passwordHash = await bcrypt.hash('correct-horse-battery-staple', 4);
    const inactive = buildUser({ email: 'inactive@example.com', passwordHash, isActive: false });
    users.set(inactive.id, inactive);

    const response = await request(server())
      .post('/auth/login')
      .send({ email: 'inactive@example.com', password: 'correct-horse-battery-staple' });

    expect(response.status).toBe(401);
  });

  it('returns the current user for a valid bearer token, without passwordHash', async () => {
    await request(server()).post('/auth/register').send({
      email: 'me@example.com',
      password: 'correct-horse-battery-staple',
      fullName: 'Me User',
    });
    const login = await request(server())
      .post('/auth/login')
      .send({ email: 'me@example.com', password: 'correct-horse-battery-staple' });

    const response = await request(server())
      .get('/auth/me')
      .set('Authorization', `Bearer ${bodyOf(login).accessToken}`);

    expect(response.status).toBe(200);
    expect(bodyOf(response).email).toBe('me@example.com');
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('rejects /auth/me with no bearer token at all', async () => {
    const response = await request(server()).get('/auth/me');

    expect(response.status).toBe(401);
  });

  it('rejects /auth/me with a malformed bearer token', async () => {
    const response = await request(server())
      .get('/auth/me')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(response.status).toBe(401);
  });

  it('accepts a token signed with the pinned HS256 algorithm', async () => {
    await request(server()).post('/auth/register').send({
      email: 'algcheck@example.com',
      password: 'correct-horse-battery-staple',
      fullName: 'Alg Check',
    });
    const login = await request(server())
      .post('/auth/login')
      .send({ email: 'algcheck@example.com', password: 'correct-horse-battery-staple' });

    const response = await request(server())
      .get('/auth/me')
      .set('Authorization', `Bearer ${bodyOf(login).accessToken}`);

    expect(response.status).toBe(200);
  });

  it('rejects a token signed with a different algorithm, even with the correct secret', async () => {
    await request(server()).post('/auth/register').send({
      email: 'wrongalg@example.com',
      password: 'correct-horse-battery-staple',
      fullName: 'Wrong Alg',
    });

    // Same JwtService instance the app uses, but explicitly signed with a
    // different algorithm than JwtStrategy's pinned allow-list (HS256).
    // If verification only checked the secret, this token would pass; the
    // algorithm allow-list is what must reject it.
    const jwtService = new JwtService({ secret: TEST_JWT_SECRET });
    const foreignAlgorithmToken = await jwtService.signAsync(
      { sub: 'does-not-matter', email: 'wrongalg@example.com', role: RoleName.LEARNER },
      { algorithm: 'HS384' },
    );

    const response = await request(server())
      .get('/auth/me')
      .set('Authorization', `Bearer ${foreignAlgorithmToken}`);

    expect(response.status).toBe(401);
  });
});
