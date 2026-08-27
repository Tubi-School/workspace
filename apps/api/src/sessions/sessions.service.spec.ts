import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { Prisma, RoleName, SessionStatus, TeacherRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { OutgoingPrimaryAction } from './dto/reassign-primary-teacher.dto.js';
import { SessionsService } from './sessions.service.js';

const COURSE_ID = 'course-1';
const PRIMARY_TEACHER_ID = 'teacher-primary';
const ASSISTANT_TEACHER_ID = 'teacher-assistant';
const SUBSTITUTE_TEACHER_ID = 'teacher-substitute';
const TERM_ID = 'term-1';

function buildCourse(overrides: Record<string, unknown> = {}) {
  return {
    id: COURSE_ID,
    primaryTeacherId: PRIMARY_TEACHER_ID,
    academicTerm: {
      id: TERM_ID,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    },
    ...overrides,
  };
}

function activeTeacher(id: string) {
  return { id, user: { isActive: true, role: RoleName.TEACHER } };
}

interface SessionCreateCallArgs {
  data: {
    attendanceCutoffAt: Date;
    teachers: { create: { teacherId: string; teacherRole: TeacherRole }[] };
  };
}

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    courseId: COURSE_ID,
    sessionDate: new Date('2026-07-01'),
    startTime: new Date('2026-07-01T11:00:00Z'),
    endTime: new Date('2026-07-01T12:00:00Z'),
    attendanceCutoffAt: new Date('2026-07-01T21:59:00Z'),
    liveMeetingUrl: 'https://example.com/meet',
    status: SessionStatus.SCHEDULED,
    canceledAt: null,
    replacementForSessionId: null,
    teachers: [],
    ...overrides,
  };
}

describe('SessionsService', () => {
  let prisma: {
    course: { findUnique: jest.Mock };
    session: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    sessionTeacher: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    teacherProfile: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: SessionsService;

  function lastSessionCreateArgs(): SessionCreateCallArgs {
    const calls = prisma.session.create.mock.calls as unknown as SessionCreateCallArgs[][];
    const args = calls.at(-1)?.[0];
    if (!args) throw new Error('session.create was not called');
    return args;
  }

  const validCreateDto = {
    courseId: COURSE_ID,
    sessionDate: '2026-07-01',
    startTime: '2026-07-01T11:00:00Z',
    endTime: '2026-07-01T12:00:00Z',
    liveMeetingUrl: 'https://example.com/meet',
  };

  beforeEach(() => {
    prisma = {
      course: { findUnique: jest.fn() },
      session: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      sessionTeacher: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      teacherProfile: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    // By default, run the transaction callback against the same mocked
    // client — individual tests only need to override this to simulate a
    // mid-transaction failure.
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
    service = new SessionsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('creates a session with the PRIMARY teacher defaulted from the course', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse());
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(PRIMARY_TEACHER_ID));
      prisma.session.create.mockResolvedValue(buildSession());

      await service.create(validCreateDto);

      const createArgs = lastSessionCreateArgs();
      expect(createArgs.data.teachers.create).toEqual([{ teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.PRIMARY }]);
    });

    it('derives attendanceCutoffAt as 21:59 UTC (23:59 Africa/Johannesburg) on sessionDate', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse());
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(PRIMARY_TEACHER_ID));
      prisma.session.create.mockResolvedValue(buildSession());

      await service.create(validCreateDto);

      const createArgs = lastSessionCreateArgs();
      expect(createArgs.data.attendanceCutoffAt.toISOString()).toBe('2026-07-01T21:59:00.000Z');
    });

    it('adds requested ASSISTANT and SUBSTITUTE teachers alongside the defaulted PRIMARY', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse());
      prisma.teacherProfile.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(activeTeacher(where.id)),
      );
      prisma.session.create.mockResolvedValue(buildSession());

      await service.create({
        ...validCreateDto,
        assistantTeacherIds: [ASSISTANT_TEACHER_ID],
        substituteTeacherIds: [SUBSTITUTE_TEACHER_ID],
      });

      const createArgs = lastSessionCreateArgs();
      expect(createArgs.data.teachers.create).toEqual(
        expect.arrayContaining([
          { teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.PRIMARY },
          { teacherId: ASSISTANT_TEACHER_ID, teacherRole: TeacherRole.ASSISTANT },
          { teacherId: SUBSTITUTE_TEACHER_ID, teacherRole: TeacherRole.SUBSTITUTE },
        ]),
      );
    });

    it('rejects with 404 when the referenced course does not exist', async () => {
      prisma.course.findUnique.mockResolvedValue(null);

      await expect(service.create(validCreateDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    it('rejects startTime >= endTime', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse());

      await expect(
        service.create({ ...validCreateDto, startTime: '2026-07-01T12:00:00Z', endTime: '2026-07-01T11:00:00Z' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    it('rejects a sessionDate that does not match the academic calendar day of startTime', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse());

      await expect(
        service.create({ ...validCreateDto, sessionDate: '2026-07-02' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a sessionDate outside the referenced academic term', async () => {
      prisma.course.findUnique.mockResolvedValue(
        buildCourse({
          academicTerm: { id: TERM_ID, startDate: new Date('2027-01-01'), endDate: new Date('2027-12-31') },
        }),
      );

      await expect(service.create(validCreateDto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects with 404 when an assistant teacher does not exist', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse());
      prisma.teacherProfile.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === PRIMARY_TEACHER_ID ? activeTeacher(PRIMARY_TEACHER_ID) : null),
      );

      await expect(
        service.create({ ...validCreateDto, assistantTeacherIds: ['ghost-teacher'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    it('rejects with 409 when an assigned teacher exists but is inactive', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse());
      prisma.teacherProfile.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === PRIMARY_TEACHER_ID
            ? activeTeacher(PRIMARY_TEACHER_ID)
            : { id: where.id, user: { isActive: false, role: RoleName.TEACHER } },
        ),
      );

      await expect(
        service.create({ ...validCreateDto, assistantTeacherIds: [ASSISTANT_TEACHER_ID] }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects assigning the same teacher to more than one role in the same request', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse());

      await expect(
        service.create({ ...validCreateDto, assistantTeacherIds: [PRIMARY_TEACHER_ID] }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.session.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects editing a session that is no longer SCHEDULED', async () => {
      prisma.session.findUnique.mockResolvedValue(buildSession({ status: SessionStatus.LIVE }));

      await expect(service.update('session-1', { liveMeetingUrl: 'https://example.com/new' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('lifecycle', () => {
    it('allows SCHEDULED -> LIVE', async () => {
      prisma.session.findUnique.mockResolvedValue(buildSession({ status: SessionStatus.SCHEDULED }));
      prisma.session.update.mockResolvedValue(buildSession({ status: SessionStatus.LIVE }));

      const result = await service.markLive('session-1');

      expect(result.status).toBe(SessionStatus.LIVE);
    });

    it('rejects LIVE from a non-SCHEDULED session', async () => {
      prisma.session.findUnique.mockResolvedValue(buildSession({ status: SessionStatus.ENDED }));

      await expect(service.markLive('session-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows LIVE -> ENDED', async () => {
      prisma.session.findUnique.mockResolvedValue(buildSession({ status: SessionStatus.LIVE }));
      prisma.session.update.mockResolvedValue(buildSession({ status: SessionStatus.ENDED }));

      const result = await service.markEnded('session-1');

      expect(result.status).toBe(SessionStatus.ENDED);
    });

    it('rejects ENDED from a SCHEDULED session (must go via LIVE)', async () => {
      prisma.session.findUnique.mockResolvedValue(buildSession({ status: SessionStatus.SCHEDULED }));

      await expect(service.markEnded('session-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows SCHEDULED -> CANCELED and sets canceledAt', async () => {
      prisma.session.findUnique.mockResolvedValue(buildSession({ status: SessionStatus.SCHEDULED }));
      prisma.session.update.mockImplementation(({ data }: { data: { canceledAt: Date } }) =>
        Promise.resolve(buildSession({ status: SessionStatus.CANCELED, canceledAt: data.canceledAt })),
      );

      const result = await service.cancel('session-1');

      expect(result.status).toBe(SessionStatus.CANCELED);
      expect(result.canceledAt).toBeInstanceOf(Date);
    });

    it('allows LIVE -> CANCELED', async () => {
      prisma.session.findUnique.mockResolvedValue(buildSession({ status: SessionStatus.LIVE }));
      prisma.session.update.mockResolvedValue(buildSession({ status: SessionStatus.CANCELED, canceledAt: new Date() }));

      const result = await service.cancel('session-1');

      expect(result.status).toBe(SessionStatus.CANCELED);
    });

    it('rejects canceling an already-ENDED session', async () => {
      prisma.session.findUnique.mockResolvedValue(buildSession({ status: SessionStatus.ENDED }));

      await expect(service.cancel('session-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('replacement sessions', () => {
    it('links a replacement session to a CANCELED original', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse());
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(PRIMARY_TEACHER_ID));
      prisma.session.findUnique.mockResolvedValue(
        buildSession({ id: 'original-session', status: SessionStatus.CANCELED, replacementForSessionId: null }),
      );
      prisma.session.create.mockResolvedValue(buildSession({ replacementForSessionId: 'original-session' }));

      const result = await service.create({ ...validCreateDto, replacementForSessionId: 'original-session' });

      expect(result.replacementForSessionId).toBe('original-session');
    });

    it('rejects replacing a session that is not CANCELED', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse());
      prisma.session.findUnique.mockResolvedValue(buildSession({ id: 'original-session', status: SessionStatus.SCHEDULED }));

      await expect(
        service.create({ ...validCreateDto, replacementForSessionId: 'original-session' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    it('rejects with 404 a replacement target that does not exist', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse());
      prisma.session.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ ...validCreateDto, replacementForSessionId: 'ghost-session' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('translates a unique-constraint violation on replacementForSessionId into 409 (already has a replacement)', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse());
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(PRIMARY_TEACHER_ID));
      prisma.session.findUnique.mockResolvedValue(
        buildSession({ id: 'original-session', status: SessionStatus.CANCELED }),
      );
      prisma.session.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`replacementForSessionId`)', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.create({ ...validCreateDto, replacementForSessionId: 'original-session' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a replacement chain containing a cycle', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse());
      // original-session (CANCELED) claims its own replacementForSessionId
      // points back to itself — a corrupted/looped chain.
      prisma.session.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === 'original-session') {
          return Promise.resolve(
            buildSession({ id: 'original-session', status: SessionStatus.CANCELED, replacementForSessionId: 'original-session' }),
          );
        }
        return Promise.resolve(null);
      });

      await expect(
        service.create({ ...validCreateDto, replacementForSessionId: 'original-session' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('staffing', () => {
    function sessionWithTeachers(teachers: { teacherId: string; teacherRole: TeacherRole }[]) {
      return buildSession({ teachers });
    }

    it('adds an ASSISTANT teacher to an existing session', async () => {
      prisma.session.findUnique.mockResolvedValue(
        sessionWithTeachers([{ teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.PRIMARY }]),
      );
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(ASSISTANT_TEACHER_ID));
      prisma.sessionTeacher.findUnique.mockResolvedValue(null);

      await service.addTeacher('session-1', { teacherId: ASSISTANT_TEACHER_ID, role: TeacherRole.ASSISTANT });

      expect(prisma.sessionTeacher.create).toHaveBeenCalledWith({
        data: { sessionId: 'session-1', teacherId: ASSISTANT_TEACHER_ID, teacherRole: TeacherRole.ASSISTANT },
      });
    });

    it('adds a SUBSTITUTE teacher to an existing session', async () => {
      prisma.session.findUnique.mockResolvedValue(
        sessionWithTeachers([{ teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.PRIMARY }]),
      );
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(SUBSTITUTE_TEACHER_ID));
      prisma.sessionTeacher.findUnique.mockResolvedValue(null);

      await service.addTeacher('session-1', { teacherId: SUBSTITUTE_TEACHER_ID, role: TeacherRole.SUBSTITUTE });

      expect(prisma.sessionTeacher.create).toHaveBeenCalledWith({
        data: { sessionId: 'session-1', teacherId: SUBSTITUTE_TEACHER_ID, teacherRole: TeacherRole.SUBSTITUTE },
      });
    });

    it('rejects adding a teacher that does not exist (404)', async () => {
      prisma.session.findUnique.mockResolvedValue(sessionWithTeachers([]));
      prisma.teacherProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.addTeacher('session-1', { teacherId: 'ghost', role: TeacherRole.ASSISTANT }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects adding an inactive teacher (409)', async () => {
      prisma.session.findUnique.mockResolvedValue(sessionWithTeachers([]));
      prisma.teacherProfile.findUnique.mockResolvedValue({
        id: ASSISTANT_TEACHER_ID,
        user: { isActive: false, role: RoleName.TEACHER },
      });

      await expect(
        service.addTeacher('session-1', { teacherId: ASSISTANT_TEACHER_ID, role: TeacherRole.ASSISTANT }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a duplicate assignment of the same teacher to the same session', async () => {
      prisma.session.findUnique.mockResolvedValue(
        sessionWithTeachers([{ teacherId: ASSISTANT_TEACHER_ID, teacherRole: TeacherRole.ASSISTANT }]),
      );
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(ASSISTANT_TEACHER_ID));
      prisma.sessionTeacher.findUnique.mockResolvedValue({
        sessionId: 'session-1',
        teacherId: ASSISTANT_TEACHER_ID,
        teacherRole: TeacherRole.ASSISTANT,
      });

      await expect(
        service.addTeacher('session-1', { teacherId: ASSISTANT_TEACHER_ID, role: TeacherRole.SUBSTITUTE }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.sessionTeacher.create).not.toHaveBeenCalled();
    });

    it('rejects adding a second PRIMARY teacher', async () => {
      prisma.session.findUnique.mockResolvedValue(
        sessionWithTeachers([{ teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.PRIMARY }]),
      );
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(ASSISTANT_TEACHER_ID));
      prisma.sessionTeacher.findUnique.mockResolvedValue(null);
      prisma.sessionTeacher.findFirst.mockResolvedValue({
        sessionId: 'session-1',
        teacherId: PRIMARY_TEACHER_ID,
        teacherRole: TeacherRole.PRIMARY,
      });

      await expect(
        service.addTeacher('session-1', { teacherId: ASSISTANT_TEACHER_ID, role: TeacherRole.PRIMARY }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.sessionTeacher.create).not.toHaveBeenCalled();
    });

    it('rejects removing the sole PRIMARY teacher (would leave zero PRIMARY)', async () => {
      prisma.session.findUnique.mockResolvedValue(
        sessionWithTeachers([{ teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.PRIMARY }]),
      );
      prisma.sessionTeacher.findUnique.mockResolvedValue({
        sessionId: 'session-1',
        teacherId: PRIMARY_TEACHER_ID,
        teacherRole: TeacherRole.PRIMARY,
      });

      await expect(service.removeTeacher('session-1', PRIMARY_TEACHER_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.sessionTeacher.delete).not.toHaveBeenCalled();
    });

    it('rejects demoting the sole PRIMARY teacher to ASSISTANT (would leave zero PRIMARY)', async () => {
      prisma.session.findUnique.mockResolvedValue(
        sessionWithTeachers([{ teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.PRIMARY }]),
      );
      prisma.sessionTeacher.findUnique.mockResolvedValue({
        sessionId: 'session-1',
        teacherId: PRIMARY_TEACHER_ID,
        teacherRole: TeacherRole.PRIMARY,
      });

      await expect(
        service.updateTeacherRole('session-1', PRIMARY_TEACHER_ID, { role: TeacherRole.ASSISTANT }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.sessionTeacher.update).not.toHaveBeenCalled();
    });

    it('removes a non-PRIMARY assignment cleanly', async () => {
      prisma.session.findUnique.mockResolvedValue(
        sessionWithTeachers([
          { teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.PRIMARY },
          { teacherId: ASSISTANT_TEACHER_ID, teacherRole: TeacherRole.ASSISTANT },
        ]),
      );
      prisma.sessionTeacher.findUnique.mockResolvedValue({
        sessionId: 'session-1',
        teacherId: ASSISTANT_TEACHER_ID,
        teacherRole: TeacherRole.ASSISTANT,
      });

      await service.removeTeacher('session-1', ASSISTANT_TEACHER_ID);

      expect(prisma.sessionTeacher.delete).toHaveBeenCalledWith({
        where: { sessionId_teacherId: { sessionId: 'session-1', teacherId: ASSISTANT_TEACHER_ID } },
      });
    });

    it('rejects updating/removing an assignment that does not exist (404)', async () => {
      prisma.session.findUnique.mockResolvedValue(sessionWithTeachers([]));
      prisma.sessionTeacher.findUnique.mockResolvedValue(null);

      await expect(service.removeTeacher('session-1', 'ghost-teacher')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reassignPrimaryTeacher', () => {
    function sessionWithTeachers(teachers: { teacherId: string; teacherRole: TeacherRole }[]) {
      return buildSession({ teachers });
    }

    beforeEach(() => {
      // findOne(sessionId) is called at the start and again to build the
      // return value at the end; a plain session shell is enough for both.
      prisma.session.findUnique.mockResolvedValue(sessionWithTeachers([]));
    });

    it('reassigns PRIMARY, moving the outgoing teacher to ASSISTANT', async () => {
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(ASSISTANT_TEACHER_ID));
      prisma.sessionTeacher.findMany.mockResolvedValue([
        { sessionId: 'session-1', teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.PRIMARY },
      ]);
      prisma.sessionTeacher.findUnique.mockResolvedValue(null); // incoming has no existing assignment

      await service.reassignPrimaryTeacher('session-1', {
        incomingTeacherId: ASSISTANT_TEACHER_ID,
        outgoingTeacherAction: OutgoingPrimaryAction.BECOME_ASSISTANT,
      });

      expect(prisma.sessionTeacher.update).toHaveBeenCalledWith({
        where: { sessionId_teacherId: { sessionId: 'session-1', teacherId: PRIMARY_TEACHER_ID } },
        data: { teacherRole: TeacherRole.ASSISTANT },
      });
      expect(prisma.sessionTeacher.create).toHaveBeenCalledWith({
        data: { sessionId: 'session-1', teacherId: ASSISTANT_TEACHER_ID, teacherRole: TeacherRole.PRIMARY },
      });
      expect(prisma.sessionTeacher.delete).not.toHaveBeenCalled();
    });

    it('reassigns PRIMARY, moving the outgoing teacher to SUBSTITUTE', async () => {
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(SUBSTITUTE_TEACHER_ID));
      prisma.sessionTeacher.findMany.mockResolvedValue([
        { sessionId: 'session-1', teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.PRIMARY },
      ]);
      prisma.sessionTeacher.findUnique.mockResolvedValue(null);

      await service.reassignPrimaryTeacher('session-1', {
        incomingTeacherId: SUBSTITUTE_TEACHER_ID,
        outgoingTeacherAction: OutgoingPrimaryAction.BECOME_SUBSTITUTE,
      });

      expect(prisma.sessionTeacher.update).toHaveBeenCalledWith({
        where: { sessionId_teacherId: { sessionId: 'session-1', teacherId: PRIMARY_TEACHER_ID } },
        data: { teacherRole: TeacherRole.SUBSTITUTE },
      });
      expect(prisma.sessionTeacher.create).toHaveBeenCalledWith({
        data: { sessionId: 'session-1', teacherId: SUBSTITUTE_TEACHER_ID, teacherRole: TeacherRole.PRIMARY },
      });
    });

    it('reassigns PRIMARY with the outgoing teacher removed from the session', async () => {
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(ASSISTANT_TEACHER_ID));
      prisma.sessionTeacher.findMany.mockResolvedValue([
        { sessionId: 'session-1', teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.PRIMARY },
      ]);
      prisma.sessionTeacher.findUnique.mockResolvedValue(null);

      await service.reassignPrimaryTeacher('session-1', {
        incomingTeacherId: ASSISTANT_TEACHER_ID,
        outgoingTeacherAction: OutgoingPrimaryAction.REMOVE,
      });

      expect(prisma.sessionTeacher.delete).toHaveBeenCalledWith({
        where: { sessionId_teacherId: { sessionId: 'session-1', teacherId: PRIMARY_TEACHER_ID } },
      });
      expect(prisma.sessionTeacher.update).not.toHaveBeenCalled();
      expect(prisma.sessionTeacher.create).toHaveBeenCalledWith({
        data: { sessionId: 'session-1', teacherId: ASSISTANT_TEACHER_ID, teacherRole: TeacherRole.PRIMARY },
      });
    });

    it('unambiguously promotes an incoming teacher who already holds a non-PRIMARY assignment, rather than creating a duplicate row', async () => {
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(ASSISTANT_TEACHER_ID));
      prisma.sessionTeacher.findMany.mockResolvedValue([
        { sessionId: 'session-1', teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.PRIMARY },
      ]);
      prisma.sessionTeacher.findUnique.mockResolvedValue({
        sessionId: 'session-1',
        teacherId: ASSISTANT_TEACHER_ID,
        teacherRole: TeacherRole.ASSISTANT,
      });

      await service.reassignPrimaryTeacher('session-1', {
        incomingTeacherId: ASSISTANT_TEACHER_ID,
        outgoingTeacherAction: OutgoingPrimaryAction.BECOME_ASSISTANT,
      });

      expect(prisma.sessionTeacher.create).not.toHaveBeenCalled();
      expect(prisma.sessionTeacher.update).toHaveBeenCalledWith({
        where: { sessionId_teacherId: { sessionId: 'session-1', teacherId: ASSISTANT_TEACHER_ID } },
        data: { teacherRole: TeacherRole.PRIMARY },
      });
    });

    it('rejects with 404 when the incoming teacher does not exist', async () => {
      prisma.teacherProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.reassignPrimaryTeacher('session-1', {
          incomingTeacherId: 'ghost-teacher',
          outgoingTeacherAction: OutgoingPrimaryAction.BECOME_ASSISTANT,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects with 409 when the incoming teacher exists but is inactive', async () => {
      prisma.teacherProfile.findUnique.mockResolvedValue({
        id: ASSISTANT_TEACHER_ID,
        user: { isActive: false, role: RoleName.TEACHER },
      });

      await expect(
        service.reassignPrimaryTeacher('session-1', {
          incomingTeacherId: ASSISTANT_TEACHER_ID,
          outgoingTeacherAction: OutgoingPrimaryAction.BECOME_ASSISTANT,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects with 409 when the session does not currently have exactly one PRIMARY', async () => {
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(ASSISTANT_TEACHER_ID));
      prisma.sessionTeacher.findMany.mockResolvedValue([]);

      await expect(
        service.reassignPrimaryTeacher('session-1', {
          incomingTeacherId: ASSISTANT_TEACHER_ID,
          outgoingTeacherAction: OutgoingPrimaryAction.BECOME_ASSISTANT,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects with 409 when the incoming teacher is already the PRIMARY teacher', async () => {
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(PRIMARY_TEACHER_ID));
      prisma.sessionTeacher.findMany.mockResolvedValue([
        { sessionId: 'session-1', teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.PRIMARY },
      ]);

      await expect(
        service.reassignPrimaryTeacher('session-1', {
          incomingTeacherId: PRIMARY_TEACHER_ID,
          outgoingTeacherAction: OutgoingPrimaryAction.BECOME_ASSISTANT,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('leaves original staffing unchanged if the transaction fails partway through', async () => {
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(ASSISTANT_TEACHER_ID));
      prisma.sessionTeacher.findMany.mockResolvedValue([
        { sessionId: 'session-1', teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.PRIMARY },
      ]);
      prisma.sessionTeacher.findUnique.mockResolvedValue(null);
      // The outgoing-teacher update (the first write inside the
      // transaction) fails; the incoming-teacher create must never run.
      prisma.sessionTeacher.update.mockRejectedValue(new Error('connection reset mid-transaction'));

      await expect(
        service.reassignPrimaryTeacher('session-1', {
          incomingTeacherId: ASSISTANT_TEACHER_ID,
          outgoingTeacherAction: OutgoingPrimaryAction.BECOME_ASSISTANT,
        }),
      ).rejects.toThrow('connection reset mid-transaction');
      expect(prisma.sessionTeacher.create).not.toHaveBeenCalled();
    });

    it('leaves the session with exactly one PRIMARY after a successful reassignment', async () => {
      prisma.teacherProfile.findUnique.mockResolvedValue(activeTeacher(ASSISTANT_TEACHER_ID));
      prisma.sessionTeacher.findMany.mockResolvedValue([
        { sessionId: 'session-1', teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.PRIMARY },
      ]);
      prisma.sessionTeacher.findUnique.mockResolvedValue(null);
      prisma.session.findUnique.mockResolvedValue(
        sessionWithTeachers([
          { teacherId: PRIMARY_TEACHER_ID, teacherRole: TeacherRole.ASSISTANT },
          { teacherId: ASSISTANT_TEACHER_ID, teacherRole: TeacherRole.PRIMARY },
        ]),
      );

      const result = await service.reassignPrimaryTeacher('session-1', {
        incomingTeacherId: ASSISTANT_TEACHER_ID,
        outgoingTeacherAction: OutgoingPrimaryAction.BECOME_ASSISTANT,
      });

      const primaryCount = result.teachers.filter((t) => t.teacherRole === TeacherRole.PRIMARY).length;
      expect(primaryCount).toBe(1);
    });
  });
});
