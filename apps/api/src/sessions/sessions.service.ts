import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { EntitlementService } from '../entitlements/entitlement.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Prisma, RoleName, SessionStatus, TeacherRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeAttendanceCutoffAtUtc, toAcademicDateString } from './academic-timezone.util.js';
import type { AssignSessionTeacherDto } from './dto/assign-session-teacher.dto.js';
import type { CreateSessionDto } from './dto/create-session.dto.js';
import {
  OutgoingPrimaryAction,
  type ReassignPrimaryTeacherDto,
} from './dto/reassign-primary-teacher.dto.js';
import type { UpdateSessionDto } from './dto/update-session.dto.js';
import type { UpdateSessionTeacherDto } from './dto/update-session-teacher.dto.js';
import { MeetingProvisioningService } from './meeting-provisioning.service.js';

const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

export const sessionInclude = {
  course: true,
  teachers: {
    include: {
      teacher: {
        select: {
          id: true,
          bio: true,
          createdAt: true,
          userId: true,
          user: { select: { id: true, email: true, fullName: true, isActive: true } },
        },
      },
    },
  },
} satisfies Prisma.SessionInclude;

export type SessionWithRelations = Prisma.SessionGetPayload<{ include: typeof sessionInclude }>;

interface TeacherAssignmentPlan {
  teacherId: string;
  role: TeacherRole;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlementService: EntitlementService,
    private readonly meetingProvisioningService: MeetingProvisioningService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Runs a best-effort notification enqueue, logging (never throwing) on
   * failure — the primary mutation this is called after has already
   * committed, and must never be reported as failed merely because
   * enqueueing its notification did not succeed (Phase 4 external review
   * Correction 8). */
  private async notifySafely(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to enqueue a notification: ${message}`);
    }
  }

  async create(dto: CreateSessionDto): Promise<SessionWithRelations> {
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
      include: { academicTerm: true },
    });

    if (!course) {
      throw new NotFoundException(`Course ${dto.courseId} not found`);
    }

    const sessionDate = new Date(dto.sessionDate);
    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);

    this.assertChronology(startTime, endTime);
    this.assertSessionDateMatchesStart(sessionDate, startTime);
    this.assertWithinAcademicTerm(sessionDate, course.academicTerm);

    if (dto.replacementForSessionId !== undefined) {
      await this.assertValidReplacementTarget(dto.replacementForSessionId);
    }

    const assignments = await this.resolveTeacherAssignments(
      course.primaryTeacherId,
      dto.assistantTeacherIds ?? [],
      dto.substituteTeacherIds ?? [],
    );

    const attendanceCutoffAt = computeAttendanceCutoffAtUtc(sessionDate);

    try {
      const created = await this.prisma.session.create({
        data: {
          courseId: dto.courseId,
          sessionDate,
          startTime,
          endTime,
          liveMeetingUrl: dto.liveMeetingUrl ?? '',
          attendanceCutoffAt,
          ...(dto.replacementForSessionId !== undefined
            ? { replacementForSessionId: dto.replacementForSessionId }
            : {}),
          teachers: {
            create: assignments.map((assignment) => ({
              teacherId: assignment.teacherId,
              teacherRole: assignment.role,
            })),
          },
        },
        include: sessionInclude,
      });

      if (dto.replacementForSessionId !== undefined) {
        // Replacement entitlement is inherited from the canceled original's
        // snapshots, never recalculated from today's subscription state
        // (frozen design section J). The original is guaranteed to already
        // have entitlement snapshots — assertValidReplacementTarget above
        // required it to be CANCELED, and every path that cancels a
        // session (markLive's evaluation, or cancel's own evaluation for a
        // session canceled before going live) evaluates entitlement first.
        await this.entitlementService.inheritForReplacement(
          dto.replacementForSessionId,
          created.id,
        );

        // Best-effort — never blocks session creation (section N/O; Phase
        // 4 external review Correction 8 — the session itself has already
        // been created above, so a notification failure here must never
        // surface as a create() failure).
        await this.notifySafely(() =>
          this.notifications.enqueueForEntitledLearners(
            dto.replacementForSessionId!,
            'SESSION_REPLACEMENT',
            { courseTitle: created.course.title, startTime: created.startTime.toISOString() },
          ),
        );
      }

      // Best-effort, never blocks session creation on a Zoom outage
      // (section E/D) — failures are recorded on the session for ADMIN to
      // see and retry via `provisionMeeting`. Skipped when an ADMIN
      // explicitly supplied a liveMeetingUrl — that is a deliberate manual
      // override (e.g. no Zoom account configured yet) that automatic
      // provisioning must not silently clobber.
      if (dto.liveMeetingUrl === undefined) {
        await this.meetingProvisioningService.provisionForSession(created.id);
        return this.findOne(created.id);
      }

      return created;
    } catch (error) {
      if (this.isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          `Session ${dto.replacementForSessionId ?? ''} already has a replacement session`,
        );
      }
      throw error;
    }
  }

  findAll(): Promise<SessionWithRelations[]> {
    return this.prisma.session.findMany({ include: sessionInclude, orderBy: { startTime: 'asc' } });
  }

  async findOne(id: string): Promise<SessionWithRelations> {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: sessionInclude,
    });

    if (!session) {
      throw new NotFoundException(`Session ${id} not found`);
    }

    return session;
  }

  /**
   * Only a still-SCHEDULED session is editable. Once it has gone LIVE,
   * ENDED, or CANCELED, its schedule is part of the historical record —
   * changing it out from under a session learners may already be tracking
   * against would corrupt that record rather than correct it.
   */
  async update(id: string, dto: UpdateSessionDto): Promise<SessionWithRelations> {
    const existing = await this.findOne(id);

    if (existing.status !== SessionStatus.SCHEDULED) {
      throw new ConflictException(
        `Session ${id} is ${existing.status} and can no longer be edited`,
      );
    }

    const courseId = dto.courseId ?? existing.courseId;
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: { academicTerm: true },
    });

    if (!course) {
      throw new NotFoundException(`Course ${courseId} not found`);
    }

    const sessionDate =
      dto.sessionDate !== undefined ? new Date(dto.sessionDate) : existing.sessionDate;
    const startTime = dto.startTime !== undefined ? new Date(dto.startTime) : existing.startTime;
    const endTime = dto.endTime !== undefined ? new Date(dto.endTime) : existing.endTime;

    this.assertChronology(startTime, endTime);
    this.assertSessionDateMatchesStart(sessionDate, startTime);
    this.assertWithinAcademicTerm(sessionDate, course.academicTerm);

    const attendanceCutoffAt = computeAttendanceCutoffAtUtc(sessionDate);

    return this.prisma.session.update({
      where: { id },
      data: {
        ...(dto.courseId !== undefined ? { courseId: dto.courseId } : {}),
        sessionDate,
        startTime,
        endTime,
        attendanceCutoffAt,
        ...(dto.liveMeetingUrl !== undefined ? { liveMeetingUrl: dto.liveMeetingUrl } : {}),
      },
      include: sessionInclude,
    });
  }

  /**
   * SCHEDULED -> LIVE is the normal entitlement trigger, but the frozen
   * entitlement point itself is always `session.startTime` — never the
   * timestamp an ADMIN happens to press the LIVE button at. Whether
   * markLive fires early or late, entitlement is evaluated as of the
   * session's own scheduled start.
   */
  async markLive(id: string): Promise<SessionWithRelations> {
    const existing = await this.findOne(id);
    this.assertTransition(existing.status, SessionStatus.SCHEDULED, SessionStatus.LIVE);

    await this.entitlementService.evaluateForSession(id, existing.startTime);

    return this.prisma.session.update({
      where: { id },
      data: { status: SessionStatus.LIVE },
      include: sessionInclude,
    });
  }

  async markEnded(id: string): Promise<SessionWithRelations> {
    const existing = await this.findOne(id);
    this.assertTransition(existing.status, SessionStatus.LIVE, SessionStatus.ENDED);

    return this.prisma.session.update({
      where: { id },
      data: { status: SessionStatus.ENDED },
      include: sessionInclude,
    });
  }

  /**
   * Frozen rule: entitlementPoint = MIN(session.startTime,
   * cancellationTime). A session canceled before its scheduled start
   * relocates the entitlement point to the cancellation moment; a session
   * canceled after its scheduled start (including one already LIVE) keeps
   * the entitlement point at the scheduled start, exactly as markLive
   * would have evaluated it. evaluateForSession is idempotent, so calling
   * it again here for a session already evaluated by markLive is always
   * safe and only ever does real work the first time.
   */
  async cancel(id: string): Promise<SessionWithRelations> {
    const existing = await this.findOne(id);

    if (existing.status !== SessionStatus.SCHEDULED && existing.status !== SessionStatus.LIVE) {
      throw new ConflictException(
        `Session ${id} is ${existing.status} and cannot be canceled (only SCHEDULED or LIVE sessions can be)`,
      );
    }

    const cancellationTime = new Date();
    const entitlementPoint =
      cancellationTime.getTime() < existing.startTime.getTime()
        ? cancellationTime
        : existing.startTime;

    await this.entitlementService.evaluateForSession(id, entitlementPoint);

    const canceled = await this.prisma.session.update({
      where: { id },
      data: { status: SessionStatus.CANCELED, canceledAt: new Date() },
      include: sessionInclude,
    });

    // Best-effort — a Zoom cleanup failure never blocks or reverses the
    // cancellation itself (section J: TUBI's state machine is
    // authoritative regardless of provider outcome).
    await this.meetingProvisioningService.releaseForCanceledSession(id);

    // Best-effort — the session is already CANCELED above; a notification
    // failure must never be reported back to the caller as a cancel()
    // failure (Phase 4 external review Correction 8).
    const payload = {
      courseTitle: canceled.course.title,
      startTime: canceled.startTime.toISOString(),
    };
    await this.notifySafely(() =>
      this.notifications.enqueueForEntitledLearners(id, 'SESSION_CANCELED', payload),
    );
    await this.notifySafely(() =>
      this.notifications.enqueueForAssignedTeachers(id, 'SESSION_CANCELED', payload),
    );

    return canceled;
  }

  /** Explicit ADMIN-triggered retry for a session whose automatic
   * provisioning failed (e.g. a transient Zoom outage). Idempotent — a
   * no-op if the session is already provisioned or canceled. */
  async provisionMeeting(id: string): Promise<SessionWithRelations> {
    await this.findOne(id);
    await this.meetingProvisioningService.provisionForSession(id);
    return this.findOne(id);
  }

  // ---------------------------------------------------------------------
  // SessionTeacher staffing
  // ---------------------------------------------------------------------

  async listTeachers(sessionId: string): Promise<SessionWithRelations['teachers']> {
    const session = await this.findOne(sessionId);
    return session.teachers;
  }

  /**
   * Adds a teacher to a session. Rejects a duplicate assignment (the same
   * teacher already staffed on this session, in any role) and rejects
   * adding a second PRIMARY outright — this API never silently replaces an
   * existing PRIMARY; the caller must remove or reassign the current one
   * first (see `updateRole`/`remove`, which themselves refuse to ever leave
   * a session with zero PRIMARY teachers).
   */
  async addTeacher(sessionId: string, dto: AssignSessionTeacherDto): Promise<SessionWithRelations> {
    await this.findOne(sessionId);
    await this.assertTeacherActive(dto.teacherId);

    const existingAssignment = await this.prisma.sessionTeacher.findUnique({
      where: { sessionId_teacherId: { sessionId, teacherId: dto.teacherId } },
    });

    if (existingAssignment) {
      throw new ConflictException(
        `Teacher ${dto.teacherId} is already assigned to session ${sessionId}`,
      );
    }

    if (dto.role === TeacherRole.PRIMARY) {
      await this.assertNoPrimaryExists(sessionId);
    }

    await this.prisma.sessionTeacher.create({
      data: { sessionId, teacherId: dto.teacherId, teacherRole: dto.role },
    });

    return this.findOne(sessionId);
  }

  /**
   * Changes an existing assignment's role.
   *
   * Refuses to leave the session with zero PRIMARY teachers (demoting the
   * sole PRIMARY away) and refuses to create a second PRIMARY (promoting a
   * teacher to PRIMARY while a different teacher already holds it) — this
   * milestone does not implement an atomic "swap the PRIMARY" operation;
   * see the completion report for the limitation this reflects.
   */
  async updateTeacherRole(
    sessionId: string,
    teacherId: string,
    dto: UpdateSessionTeacherDto,
  ): Promise<SessionWithRelations> {
    const assignment = await this.getAssignmentOrThrow(sessionId, teacherId);

    if (assignment.teacherRole === TeacherRole.PRIMARY && dto.role !== TeacherRole.PRIMARY) {
      throw new ConflictException(
        `Cannot change session ${sessionId}'s PRIMARY teacher's role — this would leave zero PRIMARY teachers`,
      );
    }

    if (dto.role === TeacherRole.PRIMARY && assignment.teacherRole !== TeacherRole.PRIMARY) {
      await this.assertNoPrimaryExists(sessionId);
    }

    await this.prisma.sessionTeacher.update({
      where: { sessionId_teacherId: { sessionId, teacherId } },
      data: { teacherRole: dto.role },
    });

    return this.findOne(sessionId);
  }

  /** Refuses to remove the sole PRIMARY teacher (would leave zero PRIMARY). */
  async removeTeacher(sessionId: string, teacherId: string): Promise<SessionWithRelations> {
    const assignment = await this.getAssignmentOrThrow(sessionId, teacherId);

    if (assignment.teacherRole === TeacherRole.PRIMARY) {
      throw new ConflictException(
        `Cannot remove session ${sessionId}'s PRIMARY teacher — this would leave zero PRIMARY teachers`,
      );
    }

    await this.prisma.sessionTeacher.delete({
      where: { sessionId_teacherId: { sessionId, teacherId } },
    });

    return this.findOne(sessionId);
  }

  /**
   * Atomically reassigns a session's PRIMARY teacher.
   *
   * The single operation this milestone's founder correction requires:
   * `addTeacher`/`updateTeacherRole`/`removeTeacher` each individually
   * refuse any write that would leave zero or two PRIMARY teachers, which
   * made a plain reassignment impossible to express as two separate calls
   * without an externally-visible zero- or two-PRIMARY moment in between.
   * This method performs both halves — demoting/removing the outgoing
   * PRIMARY and promoting the incoming teacher — inside one
   * `prisma.$transaction`, so no caller can ever observe an intermediate
   * state, and a failure partway through leaves the original staffing
   * completely unchanged (the transaction is not committed).
   */
  async reassignPrimaryTeacher(
    sessionId: string,
    dto: ReassignPrimaryTeacherDto,
  ): Promise<SessionWithRelations> {
    await this.findOne(sessionId);
    await this.assertTeacherActive(dto.incomingTeacherId);

    const primaryAssignments = await this.prisma.sessionTeacher.findMany({
      where: { sessionId, teacherRole: TeacherRole.PRIMARY },
    });

    if (primaryAssignments.length !== 1) {
      throw new ConflictException(
        `Session ${sessionId} does not currently have exactly one PRIMARY teacher (found ${primaryAssignments.length})`,
      );
    }

    const outgoingTeacherId = primaryAssignments[0]!.teacherId;

    if (outgoingTeacherId === dto.incomingTeacherId) {
      throw new ConflictException(
        `Teacher ${dto.incomingTeacherId} is already the PRIMARY teacher`,
      );
    }

    const incomingExistingAssignment = await this.prisma.sessionTeacher.findUnique({
      where: { sessionId_teacherId: { sessionId, teacherId: dto.incomingTeacherId } },
    });

    await this.prisma.$transaction(async (tx) => {
      // Resolve the outgoing PRIMARY first, per the explicit (never
      // inferred) action the caller supplied.
      if (dto.outgoingTeacherAction === OutgoingPrimaryAction.REMOVE) {
        await tx.sessionTeacher.delete({
          where: { sessionId_teacherId: { sessionId, teacherId: outgoingTeacherId } },
        });
      } else {
        const newOutgoingRole =
          dto.outgoingTeacherAction === OutgoingPrimaryAction.BECOME_ASSISTANT
            ? TeacherRole.ASSISTANT
            : TeacherRole.SUBSTITUTE;

        await tx.sessionTeacher.update({
          where: { sessionId_teacherId: { sessionId, teacherId: outgoingTeacherId } },
          data: { teacherRole: newOutgoingRole },
        });
      }

      // Promote the incoming teacher. If they already hold a non-PRIMARY
      // assignment on this session, that assignment is unambiguously the
      // one being promoted — updating it in place is safe and avoids a
      // duplicate-membership conflict; otherwise a fresh PRIMARY row is
      // created for them.
      if (incomingExistingAssignment) {
        await tx.sessionTeacher.update({
          where: { sessionId_teacherId: { sessionId, teacherId: dto.incomingTeacherId } },
          data: { teacherRole: TeacherRole.PRIMARY },
        });
      } else {
        await tx.sessionTeacher.create({
          data: { sessionId, teacherId: dto.incomingTeacherId, teacherRole: TeacherRole.PRIMARY },
        });
      }
    });

    return this.findOne(sessionId);
  }

  private async getAssignmentOrThrow(sessionId: string, teacherId: string) {
    await this.findOne(sessionId);

    const assignment = await this.prisma.sessionTeacher.findUnique({
      where: { sessionId_teacherId: { sessionId, teacherId } },
    });

    if (!assignment) {
      throw new NotFoundException(`Teacher ${teacherId} is not assigned to session ${sessionId}`);
    }

    return assignment;
  }

  private async assertNoPrimaryExists(sessionId: string): Promise<void> {
    const existingPrimary = await this.prisma.sessionTeacher.findFirst({
      where: { sessionId, teacherRole: TeacherRole.PRIMARY },
    });

    if (existingPrimary) {
      throw new ConflictException(
        `Session ${sessionId} already has a PRIMARY teacher (${existingPrimary.teacherId}) — reassign or remove it first`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Validation helpers
  // ---------------------------------------------------------------------

  private assertChronology(startTime: Date, endTime: Date): void {
    if (startTime.getTime() >= endTime.getTime()) {
      throw new BadRequestException('startTime must be strictly before endTime');
    }
  }

  private assertSessionDateMatchesStart(sessionDate: Date, startTime: Date): void {
    const sessionDateString = toAcademicDateString(sessionDate);
    const startDateString = toAcademicDateString(startTime);

    if (sessionDateString !== startDateString) {
      throw new BadRequestException(
        `sessionDate (${sessionDateString}) must match the academic calendar day (Africa/Johannesburg) that startTime falls on (${startDateString})`,
      );
    }
  }

  private assertWithinAcademicTerm(
    sessionDate: Date,
    academicTerm: { id: string; startDate: Date; endDate: Date },
  ): void {
    if (
      sessionDate.getTime() < academicTerm.startDate.getTime() ||
      sessionDate.getTime() > academicTerm.endDate.getTime()
    ) {
      throw new BadRequestException(
        `sessionDate must fall within the referenced course's academic term (${academicTerm.id})`,
      );
    }
  }

  private assertTransition(
    current: SessionStatus,
    requiredFrom: SessionStatus,
    to: SessionStatus,
  ): void {
    if (current !== requiredFrom) {
      throw new ConflictException(
        `Cannot move session from ${current} to ${to} (requires ${requiredFrom})`,
      );
    }
  }

  private async assertValidReplacementTarget(targetId: string): Promise<void> {
    const target = await this.prisma.session.findUnique({ where: { id: targetId } });

    if (!target) {
      throw new NotFoundException(`Replacement target session ${targetId} not found`);
    }

    if (target.status !== SessionStatus.CANCELED) {
      throw new ConflictException(`Replacement target session ${targetId} is not CANCELED`);
    }

    // Defensive cycle guard. In practice a cycle cannot form through this
    // API — replacementForSessionId is set only at creation time and is
    // never itself mutated afterwards — but a session's ancestry chain is
    // walked here so a corrupted or externally-written chain is still
    // rejected rather than silently accepted.
    const visited = new Set<string>([targetId]);
    let cursor: string | null = target.replacementForSessionId;
    let hops = 0;
    const MAX_HOPS = 1000;

    while (cursor !== null && hops < MAX_HOPS) {
      if (visited.has(cursor)) {
        throw new ConflictException('Replacement chain contains a cycle');
      }
      visited.add(cursor);

      const ancestor: { replacementForSessionId: string | null } | null =
        await this.prisma.session.findUnique({
          where: { id: cursor },
          select: { replacementForSessionId: true },
        });

      cursor = ancestor?.replacementForSessionId ?? null;
      hops += 1;
    }
  }

  /**
   * Resolves and validates the full teacher roster for a new session:
   * exactly one PRIMARY (defaulted from the course), plus any requested
   * ASSISTANT/SUBSTITUTE teachers. Every teacher must exist and belong to
   * an active User; every teacher may appear at most once across all
   * roles.
   */
  private async resolveTeacherAssignments(
    primaryTeacherId: string,
    assistantTeacherIds: string[],
    substituteTeacherIds: string[],
  ): Promise<TeacherAssignmentPlan[]> {
    const allIds = [primaryTeacherId, ...assistantTeacherIds, ...substituteTeacherIds];
    const duplicates = allIds.filter((id, index) => allIds.indexOf(id) !== index);

    if (duplicates.length > 0) {
      throw new ConflictException(
        `The same teacher cannot be assigned more than once to a session: ${[...new Set(duplicates)].join(', ')}`,
      );
    }

    await Promise.all(allIds.map((id) => this.assertTeacherActive(id)));

    return [
      { teacherId: primaryTeacherId, role: TeacherRole.PRIMARY },
      ...assistantTeacherIds.map((teacherId) => ({ teacherId, role: TeacherRole.ASSISTANT })),
      ...substituteTeacherIds.map((teacherId) => ({ teacherId, role: TeacherRole.SUBSTITUTE })),
    ];
  }

  /** Throws 404 if the TeacherProfile doesn't exist, 409 if it exists but
   * its User is inactive or not actually a TEACHER. */
  async assertTeacherActive(teacherId: string): Promise<void> {
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { id: teacherId },
      include: { user: true },
    });

    if (!teacher) {
      throw new NotFoundException(`Teacher ${teacherId} not found`);
    }

    if (!teacher.user.isActive || teacher.user.role !== RoleName.TEACHER) {
      throw new ConflictException(
        `Teacher ${teacherId} does not belong to an active TEACHER account`,
      );
    }
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
    );
  }
}
