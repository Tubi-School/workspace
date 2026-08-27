import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { Prisma, RoleName, type User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

function buildUser(overrides: Partial<User> = {}): User {
  const now = new Date();
  return {
    id: 'user-1',
    email: 'learner@example.com',
    passwordHash: 'irrelevant-placeholder',
    role: RoleName.LEARNER,
    fullName: 'Test Learner',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('AuthService', () => {
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    learnerProfile: {
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: AuthService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      learnerProfile: {
        create: jest.fn().mockResolvedValue({ id: 'learner-profile-1' }),
      },
      $transaction: jest.fn(),
    };
    // By default, run the transaction callback against the same mocked
    // client — individual tests only need to override this to simulate a
    // mid-transaction failure.
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );

    const jwtService = new JwtService({ secret: 'test-secret' });
    service = new AuthService(prisma as unknown as PrismaService, jwtService);
  });

  describe('register', () => {
    it('creates a LEARNER account and never returns passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }: { data: Partial<User> }) =>
        Promise.resolve(
          buildUser({
            email: data.email,
            fullName: data.fullName,
            passwordHash: data.passwordHash,
            role: data.role,
          }),
        ),
      );

      const result = await service.register({
        email: 'new@example.com',
        password: 'correct-horse-battery-staple',
        fullName: 'New Learner',
      });

      expect(result.role).toBe(RoleName.LEARNER);
      expect(result).not.toHaveProperty('passwordHash');
      // `expect.objectContaining` is typed `any` by @types/jest; the assertion
      // itself is fully type-safe about what it checks.
      expect(prisma.user.create).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ data: expect.objectContaining({ role: RoleName.LEARNER }) }),
      );
    });

    it('creates exactly one LearnerProfile for the new User, atomically', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }: { data: Partial<User> }) =>
        Promise.resolve(
          buildUser({ id: 'new-user-id', email: data.email, fullName: data.fullName }),
        ),
      );

      await service.register({
        email: 'new@example.com',
        password: 'correct-horse-battery-staple',
        fullName: 'New Learner',
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.learnerProfile.create).toHaveBeenCalledWith({
        data: { userId: 'new-user-id' },
      });
    });

    it('does not create a LearnerProfile (or a User) when the email is already registered', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());

      await expect(
        service.register({
          email: 'learner@example.com',
          password: 'whatever123',
          fullName: 'Dup',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.learnerProfile.create).not.toHaveBeenCalled();
    });

    it('stores a bcrypt hash of the password, never the plaintext', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      let storedHash = '';
      prisma.user.create.mockImplementation(({ data }: { data: Partial<User> }) => {
        storedHash = data.passwordHash ?? '';
        return Promise.resolve(buildUser({ passwordHash: storedHash }));
      });

      await service.register({
        email: 'new@example.com',
        password: 'correct-horse-battery-staple',
        fullName: 'New Learner',
      });

      expect(storedHash).not.toBe('correct-horse-battery-staple');
      expect(storedHash).toMatch(/^\$2[aby]\$/);
      await expect(bcrypt.compare('correct-horse-battery-staple', storedHash)).resolves.toBe(true);
    });

    it('rejects registration with an already-registered email', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());

      await expect(
        service.register({
          email: 'learner@example.com',
          password: 'whatever123',
          fullName: 'Dup',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('normalizes email (trim + lowercase) before checking for a duplicate and before storing it', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      let capturedEmail = '';
      prisma.user.create.mockImplementation(({ data }: { data: Partial<User> }) => {
        capturedEmail = data.email ?? '';
        return Promise.resolve(buildUser({ email: capturedEmail }));
      });

      await service.register({
        email: '  Learner@Example.COM  ',
        password: 'correct-horse-battery-staple',
        fullName: 'Cased Learner',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'learner@example.com' },
      });
      expect(capturedEmail).toBe('learner@example.com');
    });

    it('turns a database unique-constraint violation into the same 409 Conflict as the pre-check', async () => {
      // Simulates a race: the pre-check sees no existing row, but a
      // concurrent request wins the actual insert, so Prisma's own unique
      // constraint is what fails.
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`email`)',
          {
            code: 'P2002',
            clientVersion: 'test',
          },
        ),
      );

      await expect(
        service.register({
          email: 'racing@example.com',
          password: 'correct-horse-battery-staple',
          fullName: 'Racer',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('re-throws an unrelated database error rather than masking it as a duplicate', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(new Error('connection reset'));

      await expect(
        service.register({
          email: 'other-error@example.com',
          password: 'correct-horse-battery-staple',
          fullName: 'X',
        }),
      ).rejects.toThrow('connection reset');
    });
  });

  describe('login', () => {
    it('logs in with correct credentials and returns a token plus a sanitized user', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.user.findUnique.mockResolvedValue(buildUser({ passwordHash }));

      const result = await service.login({
        email: 'learner@example.com',
        password: 'correct-password',
      });

      expect(typeof result.accessToken).toBe('string');
      expect(result.accessToken.length).toBeGreaterThan(0);
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user.email).toBe('learner@example.com');
    });

    it('logs in successfully when the email differs only by case/whitespace from how it was stored', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ email: 'learner@example.com', passwordHash }),
      );

      const result = await service.login({
        email: '  Learner@Example.COM  ',
        password: 'correct-password',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'learner@example.com' },
      });
      expect(result.user.email).toBe('learner@example.com');
    });

    it('rejects an unknown email with a generic message', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'ghost@example.com', password: 'whatever' }),
      ).rejects.toMatchObject({
        message: 'Invalid email or password',
      });
    });

    it('rejects a wrong password with the same generic message', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.user.findUnique.mockResolvedValue(buildUser({ passwordHash }));

      await expect(
        service.login({ email: 'learner@example.com', password: 'wrong-password' }),
      ).rejects.toMatchObject({ message: 'Invalid email or password' });
    });

    it('rejects an inactive user even with the correct password, with the same generic message', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.user.findUnique.mockResolvedValue(buildUser({ passwordHash, isActive: false }));

      await expect(
        service.login({ email: 'learner@example.com', password: 'correct-password' }),
      ).rejects.toMatchObject({ message: 'Invalid email or password' });
    });

    it('raises UnauthorizedException (not some other error type) on failure', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'ghost@example.com', password: 'x' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('findSanitizedById', () => {
    it('returns a sanitized user for an active account', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());

      const result = await service.findSanitizedById('user-1');

      expect(result).not.toHaveProperty('passwordHash');
      expect(result.id).toBe('user-1');
    });

    it('rejects a deactivated account even if the id is valid', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ isActive: false }));

      await expect(service.findSanitizedById('user-1')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an id that no longer resolves to a user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findSanitizedById('does-not-exist')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
