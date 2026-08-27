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
    };
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
