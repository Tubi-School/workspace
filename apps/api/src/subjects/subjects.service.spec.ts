import { ConflictException, NotFoundException } from '@nestjs/common';

import type { Subject } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SubjectsService } from './subjects.service.js';

function buildSubject(overrides: Partial<Subject> = {}): Subject {
  return { id: 'subject-1', name: 'Mathematics', ...overrides };
}

describe('SubjectsService', () => {
  let prisma: {
    subject: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
    course: { count: jest.Mock };
  };
  let service: SubjectsService;

  beforeEach(() => {
    prisma = {
      subject: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      course: { count: jest.fn() },
    };
    service = new SubjectsService(prisma as unknown as PrismaService);
  });

  it('creates a subject when the name is unique', async () => {
    prisma.subject.findUnique.mockResolvedValue(null);
    prisma.subject.create.mockResolvedValue(buildSubject());

    await expect(service.create({ name: 'Mathematics' })).resolves.toMatchObject({ name: 'Mathematics' });
  });

  it('rejects a duplicate subject name with 409 Conflict', async () => {
    prisma.subject.findUnique.mockResolvedValue(buildSubject());

    await expect(service.create({ name: 'Mathematics' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException for a missing subject id', async () => {
    prisma.subject.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects deletion when a course still references the subject', async () => {
    prisma.subject.findUnique.mockResolvedValue(buildSubject());
    prisma.course.count.mockResolvedValue(1);

    await expect(service.remove('subject-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.subject.delete).not.toHaveBeenCalled();
  });

  it('deletes a subject with no referencing courses', async () => {
    prisma.subject.findUnique.mockResolvedValue(buildSubject());
    prisma.course.count.mockResolvedValue(0);

    await service.remove('subject-1');

    expect(prisma.subject.delete).toHaveBeenCalledWith({ where: { id: 'subject-1' } });
  });
});
