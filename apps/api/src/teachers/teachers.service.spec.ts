import { ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

import { Prisma, RoleName } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { TeachersService } from './teachers.service.js';

describe('TeachersService', () => {
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    teacherProfile: { create: jest.Mock; update: jest.Mock; findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: TeachersService;

  function buildTeacherProfile(overrides: Record<string, unknown> = {}) {
    const now = new Date();
    return {
      id: 'teacher-profile-1',
      userId: 'user-1',
      bio: null,
      createdAt: now,
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
        fullName: 'Teacher One',
        role: RoleName.TEACHER,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      teacherProfile: { create: jest.fn(), update: jest.fn(), findUniqueOrThrow: jest.fn() },
      $transaction: jest.fn(),
    };
    service = new TeachersService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('creates a User (role TEACHER) and TeacherProfile atomically, hashing the password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      let capturedPasswordHash = '';

      prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
        prisma.user.create.mockImplementation(({ data }: { data: { passwordHash: string } }) => {
          capturedPasswordHash = data.passwordHash;
          return Promise.resolve({ id: 'user-1' });
        });
        prisma.teacherProfile.create.mockResolvedValue(buildTeacherProfile());
        return fn(prisma);
      });

      const result = await service.create({
        email: 'teacher@example.com',
        password: 'correct-horse-battery-staple',
        fullName: 'Teacher One',
      });

      expect(result.user.role).toBe(RoleName.TEACHER);
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(capturedPasswordHash).not.toBe('correct-horse-battery-staple');
      await expect(bcrypt.compare('correct-horse-battery-staple', capturedPasswordHash)).resolves.toBe(true);
    });

    it('normalizes email (trim + lowercase) before checking for a duplicate', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
        prisma.user.create.mockResolvedValue({ id: 'user-1' });
        prisma.teacherProfile.create.mockResolvedValue(buildTeacherProfile());
        return fn(prisma);
      });

      await service.create({
        email: '  Teacher@Example.COM  ',
        password: 'correct-horse-battery-staple',
        fullName: 'Teacher One',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'teacher@example.com' } });
    });

    it('rejects an already-registered email with 409, without starting a transaction', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.create({ email: 'teacher@example.com', password: 'correct-horse-battery-staple', fullName: 'X' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('turns a database unique-constraint violation (race) into the same 409', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.create({ email: 'racing@example.com', password: 'correct-horse-battery-staple', fullName: 'X' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a missing teacher id', async () => {
      (prisma.teacherProfile as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates fullName and isActive on the User, and bio on the TeacherProfile', async () => {
      prisma.teacherProfile.create.mockResolvedValue(buildTeacherProfile());
      // findOne (used internally) resolves via teacherProfile.findUnique — add it fresh here.
      const findUnique = jest.fn().mockResolvedValue(buildTeacherProfile());
      (prisma.teacherProfile as unknown as { findUnique: jest.Mock }).findUnique = findUnique;

      prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
        prisma.teacherProfile.findUniqueOrThrow.mockResolvedValue(
          buildTeacherProfile({ bio: 'Updated bio', user: { ...buildTeacherProfile().user, isActive: false } }),
        );
        return fn(prisma);
      });

      const result = await service.update('teacher-profile-1', { bio: 'Updated bio', isActive: false });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isActive: false },
      });
      expect(prisma.teacherProfile.update).toHaveBeenCalledWith({
        where: { id: 'teacher-profile-1' },
        data: { bio: 'Updated bio' },
      });
      expect(result.user).not.toHaveProperty('passwordHash');
    });
  });
});
