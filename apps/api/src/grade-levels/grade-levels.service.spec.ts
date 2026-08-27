import { ConflictException, NotFoundException } from '@nestjs/common';

import type { GradeLevel } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { GradeLevelsService } from './grade-levels.service.js';

function buildGradeLevel(overrides: Partial<GradeLevel> = {}): GradeLevel {
  return { id: 'grade-1', name: 'Grade 8', ...overrides };
}

describe('GradeLevelsService', () => {
  let prisma: {
    gradeLevel: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    course: { count: jest.Mock };
  };
  let service: GradeLevelsService;

  beforeEach(() => {
    prisma = {
      gradeLevel: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      course: { count: jest.fn() },
    };
    service = new GradeLevelsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('creates a grade level when the name is unique', async () => {
      prisma.gradeLevel.findUnique.mockResolvedValue(null);
      prisma.gradeLevel.create.mockResolvedValue(buildGradeLevel());

      const result = await service.create({ name: 'Grade 8' });

      expect(result.name).toBe('Grade 8');
    });

    it('rejects a duplicate name with 409 Conflict', async () => {
      prisma.gradeLevel.findUnique.mockResolvedValue(buildGradeLevel());

      await expect(service.create({ name: 'Grade 8' })).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.gradeLevel.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a missing id', async () => {
      prisma.gradeLevel.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('allows renaming to the same name it already has', async () => {
      prisma.gradeLevel.findUnique.mockImplementation(
        ({ where }: { where: { id?: string; name?: string } }) =>
          Promise.resolve(
            where.id === 'grade-1' || where.name === 'Grade 8' ? buildGradeLevel() : null,
          ),
      );
      prisma.gradeLevel.update.mockResolvedValue(buildGradeLevel({ name: 'Grade 8' }));

      await expect(service.update('grade-1', { name: 'Grade 8' })).resolves.toBeDefined();
    });

    it('rejects renaming to a name already used by a different grade level', async () => {
      prisma.gradeLevel.findUnique.mockImplementation(
        ({ where }: { where: { id?: string; name?: string } }) => {
          if (where.id === 'grade-1') return Promise.resolve(buildGradeLevel());
          if (where.name === 'Grade 9')
            return Promise.resolve(buildGradeLevel({ id: 'grade-2', name: 'Grade 9' }));
          return Promise.resolve(null);
        },
      );

      await expect(service.update('grade-1', { name: 'Grade 9' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('remove', () => {
    it('deletes a grade level with no referencing courses', async () => {
      prisma.gradeLevel.findUnique.mockResolvedValue(buildGradeLevel());
      prisma.course.count.mockResolvedValue(0);

      await service.remove('grade-1');

      expect(prisma.gradeLevel.delete).toHaveBeenCalledWith({ where: { id: 'grade-1' } });
    });

    it('rejects deletion when courses still reference it', async () => {
      prisma.gradeLevel.findUnique.mockResolvedValue(buildGradeLevel());
      prisma.course.count.mockResolvedValue(2);

      await expect(service.remove('grade-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.gradeLevel.delete).not.toHaveBeenCalled();
    });
  });
});
