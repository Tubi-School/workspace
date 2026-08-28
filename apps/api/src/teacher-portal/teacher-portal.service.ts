import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { courseInclude, type CourseWithRelations } from '../courses/courses.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sessionInclude, type SessionWithRelations } from '../sessions/sessions.service.js';
import { teacherInclude, type TeacherWithUser } from '../teachers/teachers.service.js';

/**
 * Teacher-scoped self-service reads (Phase 3 external review, Correction
 * 1). Every method here derives the caller's TeacherProfile from the
 * authenticated User id — never from a client-supplied teacherId — and
 * returns only records that TeacherProfile is legitimately assigned to.
 * This replaces the frontend's prior pattern of downloading the full
 * ADMIN-scoped `/admin/courses` and `/admin/sessions` collections and
 * filtering them in the browser, which was UX only and enforced no
 * authorization boundary at all: the backend served the same broad,
 * unfiltered payload to any TEACHER caller regardless of which courses or
 * sessions were actually theirs.
 *
 * Reuses the exact same Prisma `include` shapes CoursesService and
 * SessionsService already use (`courseInclude`, `sessionInclude`,
 * `teacherInclude`, now exported from those services) rather than
 * duplicating them — the response shapes returned here are therefore
 * identical to their ADMIN-facing counterparts, just pre-filtered to one
 * teacher's own records.
 */
@Injectable()
export class TeacherPortalService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolves the caller's own TeacherProfile id. Throws 403 — not 404 —
   * for the same reason LearnerPortalService.resolveLearnerProfileId
   * does: an authenticated User with no TeacherProfile is not "looking
   * for a resource that doesn't exist", they simply hold no teacher
   * identity for this portal to scope anything to. */
  private async resolveTeacherProfileId(userId: string): Promise<string> {
    const profile = await this.prisma.teacherProfile.findUnique({ where: { userId } });

    if (!profile) {
      throw new ForbiddenException('No teacher profile is associated with this account');
    }

    return profile.id;
  }

  async getMyProfile(userId: string): Promise<TeacherWithUser> {
    const teacherId = await this.resolveTeacherProfileId(userId);

    return this.prisma.teacherProfile.findUniqueOrThrow({
      where: { id: teacherId },
      include: teacherInclude,
    });
  }

  /** Every Course this teacher is the PRIMARY teacher of. (Course has no
   * ASSISTANT/SUBSTITUTE concept of its own — those roles exist only at
   * the per-Session SessionTeacher level, see listMySessions.) */
  async listMyCourses(userId: string): Promise<CourseWithRelations[]> {
    const teacherId = await this.resolveTeacherProfileId(userId);

    return this.prisma.course.findMany({
      where: { primaryTeacherId: teacherId },
      include: courseInclude,
      orderBy: { title: 'asc' },
    });
  }

  /** Every Session this teacher is assigned to, in ANY role (PRIMARY,
   * ASSISTANT, or SUBSTITUTE) — the same "any assigned role" scoping
   * `AttendanceService.assertTeacherAssignedToSession` already applies
   * for attendance reads, applied here for the session list/detail read
   * itself. */
  async listMySessions(userId: string): Promise<SessionWithRelations[]> {
    const teacherId = await this.resolveTeacherProfileId(userId);

    return this.prisma.session.findMany({
      where: { teachers: { some: { teacherId } } },
      include: sessionInclude,
      orderBy: { startTime: 'asc' },
    });
  }

  /**
   * A single session detail read, scoped exactly like listMySessions.
   * `GET /admin/sessions/:id` is also nominally TEACHER-permitted at the
   * role-guard level, but SessionsService.findOne performs no assignment
   * check at all — any TEACHER could otherwise read any session's detail
   * by id. This method is what the teacher-facing session detail page
   * uses instead: a session this teacher is not assigned to reads as 404,
   * not merely "not linked to from their own list" — the same
   * not-confirming-existence-to-an-unrelated-caller principle
   * LearnerPortalService already applies.
   */
  async getMySession(userId: string, sessionId: string): Promise<SessionWithRelations> {
    const teacherId = await this.resolveTeacherProfileId(userId);

    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, teachers: { some: { teacherId } } },
      include: sessionInclude,
    });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    return session;
  }
}
