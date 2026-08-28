import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { RoleName, SubscriptionStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SubscriptionAccessService } from './subscription-access.service.js';

const LEARNER_ID = 'learner-1';
const OFFERING_ID = 'offering-1';

describe('SubscriptionAccessService', () => {
  let prisma: {
    learnerProfile: { findUnique: jest.Mock };
    offering: { findUnique: jest.Mock };
    subscriptionAccess: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let service: SubscriptionAccessService;

  const validDto = {
    learnerId: LEARNER_ID,
    offeringId: OFFERING_ID,
    currentPeriodStart: '2026-01-01',
    currentPeriodEnd: '2026-12-31',
  };

  beforeEach(() => {
    prisma = {
      learnerProfile: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: LEARNER_ID, user: { role: RoleName.LEARNER } }),
      },
      offering: { findUnique: jest.fn().mockResolvedValue({ id: OFFERING_ID }) },
      subscriptionAccess: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue(undefined),
      $transaction: jest.fn(),
    };
    // Runs the transaction callback against the same fake client, so the
    // service's own advisory-lock + overlap-check + write logic actually
    // executes rather than being bypassed by the mock.
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
    service = new SubscriptionAccessService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('grants access when the learner and offering both exist and dates are valid', async () => {
      prisma.subscriptionAccess.findFirst.mockResolvedValue(null);
      prisma.subscriptionAccess.create.mockResolvedValue({ id: 'grant-1', ...validDto });

      await expect(service.create(validDto)).resolves.toMatchObject({ id: 'grant-1' });
    });

    it('rejects with 404 when the learner does not exist', async () => {
      prisma.learnerProfile.findUnique.mockResolvedValue(null);

      await expect(service.create(validDto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects with 404 when the offering does not exist', async () => {
      prisma.offering.findUnique.mockResolvedValue(null);

      await expect(service.create(validDto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an invalid date window (start not before end)', async () => {
      await expect(
        service.create({
          ...validDto,
          currentPeriodStart: '2026-12-31',
          currentPeriodEnd: '2026-01-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.subscriptionAccess.create).not.toHaveBeenCalled();
    });

    it('rejects an overlapping ACTIVE grant for the same learner/offering with 409', async () => {
      prisma.subscriptionAccess.findFirst.mockResolvedValue({ id: 'existing-grant' });

      await expect(service.create(validDto)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.subscriptionAccess.create).not.toHaveBeenCalled();
    });

    it('does not check for overlap when creating a non-ACTIVE grant (e.g. a pre-recorded CANCELED import)', async () => {
      await service.create({ ...validDto, status: SubscriptionStatus.CANCELED });

      expect(prisma.subscriptionAccess.findFirst).not.toHaveBeenCalled();
      expect(prisma.subscriptionAccess.create).toHaveBeenCalled();
    });

    it('runs the overlap check and the create inside one advisory-locked transaction, keyed by (learnerId, offeringId)', async () => {
      prisma.subscriptionAccess.findFirst.mockResolvedValue(null);
      prisma.subscriptionAccess.create.mockResolvedValue({ id: 'grant-1', ...validDto });

      await service.create(validDto);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      // The overlap check ran before the create, both against the same
      // (locked) transactional client.
      const findFirstOrder = prisma.subscriptionAccess.findFirst.mock.invocationCallOrder[0]!;
      const createOrder = prisma.subscriptionAccess.create.mock.invocationCallOrder[0]!;
      expect(findFirstOrder).toBeLessThan(createOrder);
    });

    it('a legitimate non-overlapping grant for a different offering is unaffected by another learner+offering pair holding the lock', async () => {
      // Different (learnerId, offeringId) pairs use different lock keys —
      // simulated here simply by two independent create() calls both
      // succeeding, since the fake $transaction never actually contends.
      prisma.subscriptionAccess.findFirst.mockResolvedValue(null);
      prisma.subscriptionAccess.create
        .mockResolvedValueOnce({ id: 'grant-1', ...validDto })
        .mockResolvedValueOnce({ id: 'grant-2', ...validDto, offeringId: 'offering-2' });

      await service.create(validDto);
      await service.create({ ...validDto, offeringId: 'offering-2' });

      expect(prisma.subscriptionAccess.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('createWithinExistingLock', () => {
    it('reuses the same validation and overlap-check as create(), against the caller-supplied tx', async () => {
      prisma.subscriptionAccess.findFirst.mockResolvedValue(null);
      prisma.subscriptionAccess.create.mockResolvedValue({ id: 'grant-1', ...validDto });

      const result = await service.createWithinExistingLock(prisma as never, validDto);

      expect(result).toEqual({ id: 'grant-1', ...validDto });
      expect(prisma.subscriptionAccess.findFirst).toHaveBeenCalled();
      // Never opens its own transaction/lock — the caller (PaymentsService)
      // already holds one.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('still rejects an overlapping ACTIVE grant', async () => {
      prisma.subscriptionAccess.findFirst.mockResolvedValue({ id: 'existing-grant' });

      await expect(
        service.createWithinExistingLock(prisma as never, validDto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('still rejects a non-existent learner', async () => {
      prisma.learnerProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.createWithinExistingLock(prisma as never, validDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('revoke', () => {
    it('moves an ACTIVE grant to CANCELED', async () => {
      prisma.subscriptionAccess.findUnique.mockResolvedValue({
        id: 'grant-1',
        status: SubscriptionStatus.ACTIVE,
      });
      prisma.subscriptionAccess.update.mockResolvedValue({
        id: 'grant-1',
        status: SubscriptionStatus.CANCELED,
      });

      const result = await service.revoke('grant-1');

      expect(result.status).toBe(SubscriptionStatus.CANCELED);
    });

    it('rejects revoking a grant that is already CANCELED', async () => {
      prisma.subscriptionAccess.findUnique.mockResolvedValue({
        id: 'grant-1',
        status: SubscriptionStatus.CANCELED,
      });

      await expect(service.revoke('grant-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
