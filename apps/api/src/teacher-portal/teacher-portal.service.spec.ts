import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service.js';
import { TeacherPortalService } from './teacher-portal.service.js';

const USER_ID = 'user-1';
const TEACHER_ID = 'teacher-profile-1';
const OTHER_TEACHER_ID = 'teacher-profile-2';
const SESSION_ID = 'session-1';

describe('TeacherPortalService', () => {
  let prisma: {
    teacherProfile: { findUnique: jest.Mock; findUniqueOrThrow: jest.Mock };
    course: { findMany: jest.Mock };
    session: { findMany: jest.Mock; findFirst: jest.Mock };
  };
  let service: TeacherPortalService;

  beforeEach(() => {
    prisma = {
      teacherProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: TEACHER_ID, userId: USER_ID }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: TEACHER_ID, userId: USER_ID }),
      },
      course: { findMany: jest.fn().mockResolvedValue([]) },
      session: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    };
    service = new TeacherPortalService(prisma as unknown as PrismaService);
  });

  describe('identity resolution', () => {
    it('resolves the caller own TeacherProfile from the authenticated user id, never a client-supplied id', async () => {
      await service.getMyProfile(USER_ID);

      expect(prisma.teacherProfile.findUnique).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    });

    it('rejects with 403 when the authenticated account has no TeacherProfile at all', async () => {
      prisma.teacherProfile.findUnique.mockResolvedValue(null);

      await expect(service.getMyProfile(USER_ID)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.listMyCourses(USER_ID)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.listMySessions(USER_ID)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.getMySession(USER_ID, SESSION_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('listMyCourses', () => {
    it('queries only courses where this teacher is the PRIMARY teacher — never every course', async () => {
      await service.listMyCourses(USER_ID);

      expect(prisma.course.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { primaryTeacherId: TEACHER_ID } }),
      );
    });

    it('never queries by a different teacher id, proving one teacher cannot pivot to another teacher’s courses', async () => {
      await service.listMyCourses(USER_ID);

      const callArgs = (
        prisma.course.findMany.mock.calls[0] as unknown as [{ where: { primaryTeacherId: string } }]
      )[0];
      expect(callArgs.where.primaryTeacherId).not.toBe(OTHER_TEACHER_ID);
      expect(callArgs.where.primaryTeacherId).toBe(TEACHER_ID);
    });
  });

  describe('listMySessions', () => {
    it('queries only sessions this teacher is assigned to, in any role', async () => {
      await service.listMySessions(USER_ID);

      expect(prisma.session.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { teachers: { some: { teacherId: TEACHER_ID } } } }),
      );
    });

    it('never queries by a different teacher id, proving one teacher cannot pivot to another teacher’s sessions', async () => {
      await service.listMySessions(USER_ID);

      const callArgs = (
        prisma.session.findMany.mock.calls[0] as unknown as [
          { where: { teachers: { some: { teacherId: string } } } },
        ]
      )[0];
      expect(callArgs.where.teachers.some.teacherId).not.toBe(OTHER_TEACHER_ID);
      expect(callArgs.where.teachers.some.teacherId).toBe(TEACHER_ID);
    });
  });

  describe('getMySession', () => {
    it('scopes the lookup to sessionId AND this teacher’s own assignment in one query', async () => {
      prisma.session.findFirst.mockResolvedValue({ id: SESSION_ID });

      await service.getMySession(USER_ID, SESSION_ID);

      expect(prisma.session.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SESSION_ID, teachers: { some: { teacherId: TEACHER_ID } } },
        }),
      );
    });

    it('rejects with 404 (not 403) for a session this teacher is not assigned to — never confirming it exists', async () => {
      prisma.session.findFirst.mockResolvedValue(null);

      await expect(service.getMySession(USER_ID, SESSION_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
