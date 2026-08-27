import { Injectable, NotFoundException } from '@nestjs/common';

import type { AttendanceWindowException } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateWindowExceptionDto } from './dto/create-window-exception.dto.js';

/** ADMIN-only, auditable extensions to a session's normal attendance
 * cutoff — session-wide (learnerId omitted) or learner-specific. Every
 * grant is append-only; see AttendanceService.getEffectiveCutoff for how
 * precedence and "most recent wins within a scope" are resolved. */
@Injectable()
export class WindowExceptionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    sessionId: string,
    dto: CreateWindowExceptionDto,
    grantedByUserId: string,
  ): Promise<AttendanceWindowException> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    if (dto.learnerId !== undefined) {
      const learner = await this.prisma.learnerProfile.findUnique({ where: { id: dto.learnerId } });

      if (!learner) {
        throw new NotFoundException(`Learner ${dto.learnerId} not found`);
      }
    }

    return this.prisma.attendanceWindowException.create({
      data: {
        sessionId,
        learnerId: dto.learnerId ?? null,
        reason: dto.reason,
        extendedCutoffAt: new Date(dto.extendedCutoffAt),
        grantedByUserId,
        note: dto.note,
      },
    });
  }

  findForSession(sessionId: string): Promise<AttendanceWindowException[]> {
    return this.prisma.attendanceWindowException.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
