import { ConflictException, NotFoundException } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service.js';
import { CoursesService } from './courses.service.js';

const VALID_IDS = {
  subjectId: 'subject-1',
  gradeLevelId: 'grade-1',
  academicTermId: 'term-1',
  primaryTeacherId: 'teacher-1',
};

describe('CoursesService', () => {
  let prisma: {
    subject: { findUnique: jest.Mock };
    gradeLevel: { findUnique: jest.Mock };
    academicTerm: { findUnique: jest.Mock };
    teacherProfile: { findUnique: jest.Mock };
    course: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    session: { count: jest.Mock };
  };
  let service: CoursesService;

  function mockAllReferencesExist(): void {
    prisma.subject.findUnique.mockResolvedValue({ id: VALID_IDS.subjectId, name: 'Mathematics' });
    prisma.gradeLevel.findUnique.mockResolvedValue({ id: VALID_IDS.gradeLevelId, name: 'Grade 8' });
    prisma.academicTerm.findUnique.mockResolvedValue({ id: VALID_IDS.academicTermId });
    prisma.teacherProfile.findUnique.mockResolvedValue({ id: VALID_IDS.primaryTeacherId });
  }

  beforeEach(() => {
    prisma = {
      subject: { findUnique: jest.fn() },
      gradeLevel: { findUnique: jest.fn() },
      academicTerm: { findUnique: jest.fn() },
      teacherProfile: { findUnique: jest.fn() },
      course: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      session: { count: jest.fn() },
    };
    service = new CoursesService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('creates a course when every referenced entity exists', async () => {
      mockAllReferencesExist();
      prisma.course.create.mockResolvedValue({
        id: 'course-1',
        title: 'Grade 8 Mathematics',
        ...VALID_IDS,
      });

      await expect(
        service.create({ ...VALID_IDS, title: 'Grade 8 Mathematics' }),
      ).resolves.toMatchObject({ title: 'Grade 8 Mathematics' });
    });

    it('rejects creation with 404 when the referenced teacher (valid UUID, no matching row) does not exist', async () => {
      mockAllReferencesExist();
      prisma.teacherProfile.findUnique.mockResolvedValue(null);

      await expect(service.create({ ...VALID_IDS, title: 'Course' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.course.create).not.toHaveBeenCalled();
    });

    it('rejects creation with 404 when multiple referenced entities are missing, naming all of them', async () => {
      prisma.subject.findUnique.mockResolvedValue(null);
      prisma.gradeLevel.findUnique.mockResolvedValue(null);
      prisma.academicTerm.findUnique.mockResolvedValue({ id: VALID_IDS.academicTermId });
      prisma.teacherProfile.findUnique.mockResolvedValue({ id: VALID_IDS.primaryTeacherId });

      let caught: NotFoundException | undefined;
      try {
        await service.create({ ...VALID_IDS, title: 'Course' });
      } catch (error) {
        caught = error as NotFoundException;
      }

      expect(caught).toBeInstanceOf(NotFoundException);
      const response = caught?.getResponse() as { message: string[] };
      expect(response.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('subjectId'),
          expect.stringContaining('gradeLevelId'),
        ]),
      );
      expect(prisma.course.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a missing course id', async () => {
      prisma.course.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects updating to a non-existent subject with 404', async () => {
      prisma.course.findUnique.mockResolvedValue({ id: 'course-1', ...VALID_IDS, title: 'Course' });
      prisma.subject.findUnique.mockResolvedValue(null);

      await expect(
        service.update('course-1', { subjectId: 'ghost-subject' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('rejects deletion when a session still references the course', async () => {
      prisma.course.findUnique.mockResolvedValue({ id: 'course-1', ...VALID_IDS, title: 'Course' });
      prisma.session.count.mockResolvedValue(1);

      await expect(service.remove('course-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.course.delete).not.toHaveBeenCalled();
    });

    it('deletes a course with no referencing sessions', async () => {
      prisma.course.findUnique.mockResolvedValue({ id: 'course-1', ...VALID_IDS, title: 'Course' });
      prisma.session.count.mockResolvedValue(0);

      await service.remove('course-1');

      expect(prisma.course.delete).toHaveBeenCalledWith({ where: { id: 'course-1' } });
    });
  });
});
