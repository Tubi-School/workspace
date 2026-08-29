import { ConflictException, NotFoundException } from '@nestjs/common';

import { DeliveryMode, Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { OfferingsService } from './offerings.service.js';

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function recordNotFoundError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('not found', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

describe('OfferingsService', () => {
  let prisma: {
    offering: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    offeringCourse: { findUnique: jest.Mock; create: jest.Mock; delete: jest.Mock };
    course: { findMany: jest.Mock };
  };
  let service: OfferingsService;

  beforeEach(() => {
    prisma = {
      offering: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      offeringCourse: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
      course: { findMany: jest.fn() },
    };
    service = new OfferingsService(prisma as unknown as PrismaService);
  });

  it('lists offerings ordered by name', async () => {
    prisma.offering.findMany.mockResolvedValue([{ id: '1', name: 'Live Math' }]);

    await expect(service.findAll()).resolves.toEqual([{ id: '1', name: 'Live Math' }]);
    expect(prisma.offering.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
  });

  it('returns one offering by id', async () => {
    prisma.offering.findUnique.mockResolvedValue({ id: '1', name: 'Live Math' });

    await expect(service.findOne('1')).resolves.toEqual({ id: '1', name: 'Live Math' });
  });

  it('rejects with 404 for a nonexistent offering', async () => {
    prisma.offering.findUnique.mockResolvedValue(null);

    await expect(service.findOne('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('create', () => {
    it('creates an offering with attached courses in one write (Phase 5 — closes the no-Offering-creation-path gap)', async () => {
      prisma.course.findMany.mockResolvedValue([{ id: 'course-1' }]);
      prisma.offering.create.mockResolvedValue({
        id: 'offering-1',
        name: 'Grade 8 Live Bundle',
        deliveryMode: DeliveryMode.LIVE_AND_RECORDED,
        monthlyPrice: '150.00',
        courses: [{ courseId: 'course-1', course: { id: 'course-1', title: 'Algebra I' } }],
      });

      const result = await service.create({
        name: 'Grade 8 Live Bundle',
        deliveryMode: DeliveryMode.LIVE_AND_RECORDED,
        monthlyPrice: 150,
        courseIds: ['course-1'],
      });

      expect(prisma.course.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['course-1'] } } }),
      );
      expect(result.id).toBe('offering-1');
    });

    it('rejects creation referencing a nonexistent course', async () => {
      prisma.course.findMany.mockResolvedValue([]);

      await expect(
        service.create({
          name: 'x',
          deliveryMode: DeliveryMode.RECORDED_ONLY,
          monthlyPrice: 10,
          courseIds: ['ghost-course'],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.offering.create).not.toHaveBeenCalled();
    });

    it('allows creating an offering with zero courses (attached later)', async () => {
      prisma.offering.create.mockResolvedValue({ id: 'offering-1', courses: [] });

      await service.create({
        name: 'x',
        deliveryMode: DeliveryMode.RECORDED_ONLY,
        monthlyPrice: 10,
        courseIds: [],
      });

      expect(prisma.course.findMany).not.toHaveBeenCalled();
      expect(prisma.offering.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates name/monthlyPrice only — never deliveryMode', async () => {
      prisma.offering.findUnique.mockResolvedValue({ id: 'offering-1' });
      prisma.offering.update.mockResolvedValue({ id: 'offering-1', name: 'New name' });

      await service.update('offering-1', { name: 'New name' });

      expect(prisma.offering.update).toHaveBeenCalledWith({
        where: { id: 'offering-1' },
        data: { name: 'New name' },
      });
    });

    it('rejects updating a nonexistent offering', async () => {
      prisma.offering.findUnique.mockResolvedValue(null);

      await expect(service.update('ghost', { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('addCourse / removeCourse', () => {
    it('attaches a course to an offering', async () => {
      prisma.offering.findUnique.mockResolvedValue({ id: 'offering-1' });
      prisma.course.findMany.mockResolvedValue([{ id: 'course-1' }]);
      prisma.offeringCourse.findUnique.mockResolvedValue(null);

      await service.addCourse('offering-1', { courseId: 'course-1' });

      expect(prisma.offeringCourse.create).toHaveBeenCalledWith({
        data: { offeringId: 'offering-1', courseId: 'course-1' },
      });
    });

    it('rejects attaching a course already on the offering', async () => {
      prisma.offering.findUnique.mockResolvedValue({ id: 'offering-1' });
      prisma.course.findMany.mockResolvedValue([{ id: 'course-1' }]);
      prisma.offeringCourse.findUnique.mockResolvedValue({
        offeringId: 'offering-1',
        courseId: 'course-1',
      });

      await expect(
        service.addCourse('offering-1', { courseId: 'course-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.offeringCourse.create).not.toHaveBeenCalled();
    });

    it('removes a course from an offering', async () => {
      prisma.offering.findUnique.mockResolvedValue({ id: 'offering-1' });
      prisma.offeringCourse.findUnique.mockResolvedValue({
        offeringId: 'offering-1',
        courseId: 'course-1',
      });

      await service.removeCourse('offering-1', 'course-1');

      expect(prisma.offeringCourse.delete).toHaveBeenCalledWith({
        where: { offeringId_courseId: { offeringId: 'offering-1', courseId: 'course-1' } },
      });
    });

    it('rejects removing a course not on the offering', async () => {
      prisma.offering.findUnique.mockResolvedValue({ id: 'offering-1' });
      prisma.offeringCourse.findUnique.mockResolvedValue(null);

      await expect(service.removeCourse('offering-1', 'course-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('turns a concurrent duplicate attach (Prisma P2002 past the pre-check) into a 409, not a 500', async () => {
      prisma.offering.findUnique.mockResolvedValue({ id: 'offering-1' });
      prisma.course.findMany.mockResolvedValue([{ id: 'course-1' }]);
      // Pre-check sees no existing row (this request "won" the read)...
      prisma.offeringCourse.findUnique.mockResolvedValue(null);
      // ...but a concurrent request's create already landed by the time
      // this one attempts its own create.
      prisma.offeringCourse.create.mockRejectedValue(uniqueConstraintError());

      await expect(
        service.addCourse('offering-1', { courseId: 'course-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('re-throws a non-constraint error from addCourse unchanged', async () => {
      prisma.offering.findUnique.mockResolvedValue({ id: 'offering-1' });
      prisma.course.findMany.mockResolvedValue([{ id: 'course-1' }]);
      prisma.offeringCourse.findUnique.mockResolvedValue(null);
      const unrelated = new Error('connection reset');
      prisma.offeringCourse.create.mockRejectedValue(unrelated);

      await expect(service.addCourse('offering-1', { courseId: 'course-1' })).rejects.toBe(
        unrelated,
      );
    });

    it('turns a concurrent already-removed detach (Prisma P2025 past the pre-check) into a 404, not a 500', async () => {
      prisma.offering.findUnique.mockResolvedValue({ id: 'offering-1' });
      // Pre-check sees the row still present...
      prisma.offeringCourse.findUnique.mockResolvedValue({
        offeringId: 'offering-1',
        courseId: 'course-1',
      });
      // ...but a concurrent removal deleted it first.
      prisma.offeringCourse.delete.mockRejectedValue(recordNotFoundError());

      await expect(service.removeCourse('offering-1', 'course-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('re-throws a non-constraint error from removeCourse unchanged', async () => {
      prisma.offering.findUnique.mockResolvedValue({ id: 'offering-1' });
      prisma.offeringCourse.findUnique.mockResolvedValue({
        offeringId: 'offering-1',
        courseId: 'course-1',
      });
      const unrelated = new Error('connection reset');
      prisma.offeringCourse.delete.mockRejectedValue(unrelated);

      await expect(service.removeCourse('offering-1', 'course-1')).rejects.toBe(unrelated);
    });
  });
});
