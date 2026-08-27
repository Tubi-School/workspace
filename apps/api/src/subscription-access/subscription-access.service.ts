import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  RoleName,
  SubscriptionStatus,
  type SubscriptionAccess,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateSubscriptionAccessDto } from './dto/create-subscription-access.dto.js';
import type { UpdateSubscriptionAccessDto } from './dto/update-subscription-access.dto.js';

@Injectable()
export class SubscriptionAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSubscriptionAccessDto): Promise<SubscriptionAccess> {
    const learner = await this.prisma.learnerProfile.findUnique({
      where: { id: dto.learnerId },
      include: { user: true },
    });

    if (!learner) {
      throw new NotFoundException(`Learner ${dto.learnerId} not found`);
    }

    if (learner.user.role !== RoleName.LEARNER) {
      // Cannot happen through normal registration, but this is the
      // domain invariant a grant depends on — checked explicitly rather
      // than assumed.
      throw new ConflictException(`User ${learner.user.id} is not a LEARNER`);
    }

    const offering = await this.prisma.offering.findUnique({ where: { id: dto.offeringId } });

    if (!offering) {
      throw new NotFoundException(`Offering ${dto.offeringId} not found`);
    }

    const currentPeriodStart = new Date(dto.currentPeriodStart);
    const currentPeriodEnd = new Date(dto.currentPeriodEnd);
    this.assertValidWindow(currentPeriodStart, currentPeriodEnd);

    const status = dto.status ?? SubscriptionStatus.ACTIVE;

    if (status === SubscriptionStatus.ACTIVE) {
      await this.assertNoOverlappingActiveGrant(
        dto.learnerId,
        dto.offeringId,
        currentPeriodStart,
        currentPeriodEnd,
      );
    }

    return this.prisma.subscriptionAccess.create({
      data: {
        learnerId: dto.learnerId,
        offeringId: dto.offeringId,
        status,
        currentPeriodStart,
        currentPeriodEnd,
      },
    });
  }

  findAll(): Promise<SubscriptionAccess[]> {
    return this.prisma.subscriptionAccess.findMany({ orderBy: { currentPeriodStart: 'desc' } });
  }

  async findOne(id: string): Promise<SubscriptionAccess> {
    const grant = await this.prisma.subscriptionAccess.findUnique({ where: { id } });

    if (!grant) {
      throw new NotFoundException(`Subscription access ${id} not found`);
    }

    return grant;
  }

  async update(id: string, dto: UpdateSubscriptionAccessDto): Promise<SubscriptionAccess> {
    const existing = await this.findOne(id);

    const currentPeriodStart =
      dto.currentPeriodStart !== undefined
        ? new Date(dto.currentPeriodStart)
        : existing.currentPeriodStart;
    const currentPeriodEnd =
      dto.currentPeriodEnd !== undefined
        ? new Date(dto.currentPeriodEnd)
        : existing.currentPeriodEnd;
    this.assertValidWindow(currentPeriodStart, currentPeriodEnd);

    const status = dto.status ?? existing.status;

    if (status === SubscriptionStatus.ACTIVE) {
      await this.assertNoOverlappingActiveGrant(
        existing.learnerId,
        existing.offeringId,
        currentPeriodStart,
        currentPeriodEnd,
        id,
      );
    }

    return this.prisma.subscriptionAccess.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.currentPeriodStart !== undefined ? { currentPeriodStart } : {}),
        ...(dto.currentPeriodEnd !== undefined ? { currentPeriodEnd } : {}),
      },
    });
  }

  /** Revokes a grant by moving it to CANCELED — the model's own supported
   * deactivation, never a delete (SessionEntitlementSnapshot rows may
   * already reference this grant as historical truth). */
  async revoke(id: string): Promise<SubscriptionAccess> {
    const existing = await this.findOne(id);

    if (
      existing.status !== SubscriptionStatus.ACTIVE &&
      existing.status !== SubscriptionStatus.PAST_DUE
    ) {
      throw new ConflictException(`Subscription access ${id} is already ${existing.status}`);
    }

    return this.prisma.subscriptionAccess.update({
      where: { id },
      data: { status: SubscriptionStatus.CANCELED },
    });
  }

  private assertValidWindow(start: Date, end: Date): void {
    if (start.getTime() >= end.getTime()) {
      throw new BadRequestException('currentPeriodStart must be strictly before currentPeriodEnd');
    }
  }

  private async assertNoOverlappingActiveGrant(
    learnerId: string,
    offeringId: string,
    start: Date,
    end: Date,
    excludeId?: string,
  ): Promise<void> {
    const overlapping = await this.prisma.subscriptionAccess.findFirst({
      where: {
        learnerId,
        offeringId,
        status: SubscriptionStatus.ACTIVE,
        ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
        currentPeriodStart: { lte: end },
        currentPeriodEnd: { gte: start },
      },
    });

    if (overlapping) {
      throw new ConflictException(
        `Learner ${learnerId} already has an overlapping ACTIVE subscription access grant (${overlapping.id}) for offering ${offeringId}`,
      );
    }
  }
}
