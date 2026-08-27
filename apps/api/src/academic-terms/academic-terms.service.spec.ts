import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import type { AcademicTerm } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AcademicTermsService } from './academic-terms.service.js';

function buildTerm(overrides: Partial<AcademicTerm> = {}): AcademicTerm {
  return {
    id: 'term-1',
    name: '2026 Term 3',
    startDate: new Date('2026-07-01'),
    endDate: new Date('2026-09-30'),
    timezone: 'Africa/Johannesburg',
    ...overrides,
  };
}

describe('AcademicTermsService', () => {
  let prisma: {
    academicTerm: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    course: { count: jest.Mock };
  };
  let service: AcademicTermsService;

  beforeEach(() => {
    prisma = {
      academicTerm: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      course: { count: jest.fn() },
    };
    service = new AcademicTermsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('creates a term when startDate is before endDate', async () => {
      prisma.academicTerm.create.mockResolvedValue(buildTerm());

      await expect(
        service.create({ name: '2026 Term 3', startDate: '2026-07-01', endDate: '2026-09-30' }),
      ).resolves.toMatchObject({ name: '2026 Term 3' });
    });

    it('rejects a reversed date range', async () => {
      await expect(
        service.create({ name: 'Bad Term', startDate: '2026-09-30', endDate: '2026-07-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.academicTerm.create).not.toHaveBeenCalled();
    });

    it('rejects a zero-duration range (startDate equal to endDate)', async () => {
      await expect(
        service.create({ name: 'Zero Duration', startDate: '2026-07-01', endDate: '2026-07-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets the Prisma schema default apply the canonical timezone when omitted', async () => {
      prisma.academicTerm.create.mockResolvedValue(buildTerm());

      await service.create({ name: '2026 Term 3', startDate: '2026-07-01', endDate: '2026-09-30' });

      const calls = prisma.academicTerm.create.mock.calls as unknown as {
        data: Record<string, unknown>;
      }[][];
      expect(calls[0]?.[0]?.data).not.toHaveProperty('timezone');
    });
  });

  describe('update', () => {
    it('validates the resulting range using the existing date when only one side changes', async () => {
      prisma.academicTerm.findUnique.mockResolvedValue(buildTerm());

      // Existing endDate is 2026-09-30; moving startDate past it must fail.
      await expect(service.update('term-1', { startDate: '2026-10-01' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.academicTerm.update).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a missing id', async () => {
      prisma.academicTerm.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('rejects deletion when a course still references the term', async () => {
      prisma.academicTerm.findUnique.mockResolvedValue(buildTerm());
      prisma.course.count.mockResolvedValue(1);

      await expect(service.remove('term-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.academicTerm.delete).not.toHaveBeenCalled();
    });
  });
});
