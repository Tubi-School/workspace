import { Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateLearnerDto } from './dto/update-learner.dto.js';

/** Same safe-field pattern as Phase 2E's TeachersService — passwordHash is
 * never selected, so it structurally cannot leak. */
const learnerInclude = {
  user: {
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.LearnerProfileInclude;

export type LearnerWithUser = Prisma.LearnerProfileGetPayload<{ include: typeof learnerInclude }>;

/**
 * Read/administer LearnerProfiles created by public self-registration (see
 * AuthService.register). There is no create endpoint here — learners are
 * only ever created through registration — and no delete endpoint, for the
 * same reason Phase 2D/2E don't offer one: a LearnerProfile is referenced
 * by SubscriptionAccess, SessionEntitlementSnapshot, and AttendanceRecord.
 * `User.isActive = false` is the supported way to deactivate one.
 */
@Injectable()
export class LearnersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<LearnerWithUser[]> {
    return this.prisma.learnerProfile.findMany({
      include: learnerInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string): Promise<LearnerWithUser> {
    const learner = await this.prisma.learnerProfile.findUnique({
      where: { id },
      include: learnerInclude,
    });

    if (!learner) {
      throw new NotFoundException(`Learner ${id} not found`);
    }

    return learner;
  }

  async update(id: string, dto: UpdateLearnerDto): Promise<LearnerWithUser> {
    const existing = await this.findOne(id);

    if (dto.fullName !== undefined || dto.isActive !== undefined) {
      await this.prisma.user.update({
        where: { id: existing.user.id },
        data: {
          ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    }

    return this.findOne(id);
  }
}
