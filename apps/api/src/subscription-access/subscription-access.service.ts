import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { withAdvisoryLock } from '../common/pg-advisory-lock.util.js';
import {
  Prisma,
  RoleName,
  SubscriptionStatus,
  type SubscriptionAccess,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateSubscriptionAccessDto } from './dto/create-subscription-access.dto.js';
import type { UpdateSubscriptionAccessDto } from './dto/update-subscription-access.dto.js';

/** Db is either PrismaService or an in-flight transaction client — the
 * overlap check and the write must run against the same connection inside
 * the advisory-locked transaction, or the lock does not actually cover
 * them. */
type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class SubscriptionAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSubscriptionAccessDto): Promise<SubscriptionAccess> {
    const validated = await this.validateGrantInputs(this.prisma, dto);

    // The overlap pre-check and the create must be indivisible from the
    // perspective of any other concurrent grant request for the same
    // (learnerId, offeringId) pair — otherwise two simultaneous requests
    // can each pass the pre-check before either commits, producing two
    // conflicting ACTIVE grants (the concurrency gap flagged in the
    // Phase 2F review, closed here per Phase 2G Correction A). A
    // Postgres advisory lock, held for one transaction, serializes only
    // requests that collide on this exact learner+offering pair —
    // unrelated grants never contend.
    return withAdvisoryLock(
      this.prisma,
      `subscription-access:${dto.learnerId}:${dto.offeringId}`,
      (tx) => this.createLocked(tx, validated),
    );
  }

  /**
   * For a caller (`PaymentsService.confirmPayment`) that already holds an
   * open transaction and has ALREADY acquired the exact same advisory lock
   * (`subscription-access:{learnerId}:{offeringId}`) within it — reuses
   * this service's own validation and overlap-check rather than
   * duplicating it, without opening a second, nested transaction/lock of
   * its own (Prisma transaction clients cannot be nested). The caller is
   * responsible for the lock; this method only assumes it is already held.
   */
  async createWithinExistingLock(
    tx: Prisma.TransactionClient,
    dto: CreateSubscriptionAccessDto,
  ): Promise<SubscriptionAccess> {
    const validated = await this.validateGrantInputs(tx, dto);
    return this.createLocked(tx, validated);
  }

  private async validateGrantInputs(
    db: Db,
    dto: CreateSubscriptionAccessDto,
  ): Promise<{
    learnerId: string;
    offeringId: string;
    status: SubscriptionStatus;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
  }> {
    const learner = await db.learnerProfile.findUnique({
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

    const offering = await db.offering.findUnique({ where: { id: dto.offeringId } });

    if (!offering) {
      throw new NotFoundException(`Offering ${dto.offeringId} not found`);
    }

    const currentPeriodStart = new Date(dto.currentPeriodStart);
    const currentPeriodEnd = new Date(dto.currentPeriodEnd);
    this.assertValidWindow(currentPeriodStart, currentPeriodEnd);

    return {
      learnerId: dto.learnerId,
      offeringId: dto.offeringId,
      status: dto.status ?? SubscriptionStatus.ACTIVE,
      currentPeriodStart,
      currentPeriodEnd,
    };
  }

  private async createLocked(
    tx: Prisma.TransactionClient,
    validated: {
      learnerId: string;
      offeringId: string;
      status: SubscriptionStatus;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
    },
  ): Promise<SubscriptionAccess> {
    if (validated.status === SubscriptionStatus.ACTIVE) {
      await this.assertNoOverlappingActiveGrant(
        validated.learnerId,
        validated.offeringId,
        validated.currentPeriodStart,
        validated.currentPeriodEnd,
        undefined,
        tx,
      );
    }

    return tx.subscriptionAccess.create({
      data: {
        learnerId: validated.learnerId,
        offeringId: validated.offeringId,
        status: validated.status,
        currentPeriodStart: validated.currentPeriodStart,
        currentPeriodEnd: validated.currentPeriodEnd,
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

    // Same concurrency reasoning as create(): the overlap check and the
    // write must be indivisible under the same per-(learner, offering)
    // advisory lock.
    return withAdvisoryLock(
      this.prisma,
      `subscription-access:${existing.learnerId}:${existing.offeringId}`,
      async (tx) => {
        if (status === SubscriptionStatus.ACTIVE) {
          await this.assertNoOverlappingActiveGrant(
            existing.learnerId,
            existing.offeringId,
            currentPeriodStart,
            currentPeriodEnd,
            id,
            tx,
          );
        }

        return tx.subscriptionAccess.update({
          where: { id },
          data: {
            ...(dto.status !== undefined ? { status: dto.status } : {}),
            ...(dto.currentPeriodStart !== undefined ? { currentPeriodStart } : {}),
            ...(dto.currentPeriodEnd !== undefined ? { currentPeriodEnd } : {}),
          },
        });
      },
    );
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
    excludeId: string | undefined,
    db: Db,
  ): Promise<void> {
    const overlapping = await db.subscriptionAccess.findFirst({
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
