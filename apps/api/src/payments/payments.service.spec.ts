import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/environment.js';
import { PaymentStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SubscriptionAccessService } from '../subscription-access/subscription-access.service.js';
import { PaymentsService } from './payments.service.js';

describe('PaymentsService', () => {
  let prisma: {
    learnerProfile: { findUnique: jest.Mock };
    offering: { findUnique: jest.Mock };
    paymentOrder: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let config: ConfigService<AppConfig, true>;
  let subscriptionAccessService: { createWithinExistingLock: jest.Mock };
  let provider: {
    name: string;
    isConfigured: jest.Mock;
    initializeCheckout: jest.Mock;
    verifyWebhookSignature: jest.Mock;
    parseWebhookEvent: jest.Mock;
  };
  let service: PaymentsService;

  beforeEach(() => {
    prisma = {
      learnerProfile: { findUnique: jest.fn() },
      offering: { findUnique: jest.fn() },
      paymentOrder: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue(undefined),
    };
    // Mirrors the SubscriptionAccessService/SessionsService test pattern —
    // the transaction callback runs against the same mocked client, so
    // confirmPayment's reads/writes inside `withAdvisoryLock` are visible
    // to assertions the same way they would be against a real `tx`.
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
    config = {
      get: (key: string) =>
        key === 'PAYMENTS_CALLBACK_URL'
          ? 'https://app.example.com/learner/subscription'
          : undefined,
    } as unknown as ConfigService<AppConfig, true>;
    subscriptionAccessService = { createWithinExistingLock: jest.fn() };
    provider = {
      name: 'PAYSTACK',
      isConfigured: jest.fn().mockReturnValue(true),
      initializeCheckout: jest.fn(),
      verifyWebhookSignature: jest.fn(),
      parseWebhookEvent: jest.fn(),
    };
    service = new PaymentsService(
      prisma as unknown as PrismaService,
      config,
      subscriptionAccessService as unknown as SubscriptionAccessService,
      provider,
    );
  });

  describe('isConfigured', () => {
    it('is false when provider credentials exist but the callback URL is missing', () => {
      config = { get: () => undefined } as unknown as ConfigService<AppConfig, true>;
      service = new PaymentsService(
        prisma as unknown as PrismaService,
        config,
        subscriptionAccessService as unknown as SubscriptionAccessService,
        provider,
      );

      expect(service.isConfigured()).toBe(false);
    });

    it('is true only when provider credentials and the callback URL are present', () => {
      expect(service.isConfigured()).toBe(true);
      provider.isConfigured.mockReturnValue(false);
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('initiateCheckout', () => {
    it('rejects with a clear error when the provider is not configured (never fakes a payment)', async () => {
      provider.isConfigured.mockReturnValue(false);

      await expect(service.initiateCheckout('learner-1', 'offering-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.paymentOrder.create).not.toHaveBeenCalled();
    });

    it('creates a PENDING PaymentOrder in integer ZAR minor units and initializes checkout', async () => {
      prisma.learnerProfile.findUnique.mockResolvedValue({
        id: 'learner-1',
        user: { email: 'learner@example.com' },
      });
      prisma.offering.findUnique.mockResolvedValue({ id: 'offering-1', monthlyPrice: '150.00' });
      prisma.paymentOrder.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'order-1', ...data }),
      );
      provider.initializeCheckout.mockResolvedValue({ checkoutUrl: 'https://paystack.co/pay/abc' });

      const result = await service.initiateCheckout('learner-1', 'offering-1');

      const calls = prisma.paymentOrder.create.mock.calls as unknown as [
        { data: { amountMinor: number; currency: string; status: PaymentStatus } },
      ][];
      const createArgs = calls[0]?.[0];
      if (!createArgs) throw new Error('paymentOrder.create was not called');
      expect(createArgs.data).toMatchObject({
        amountMinor: 15000,
        currency: 'ZAR',
        status: PaymentStatus.PENDING,
      });
      expect(result).toEqual({ checkoutUrl: 'https://paystack.co/pay/abc' });
    });

    it('marks the order FAILED if the provider call itself throws', async () => {
      prisma.learnerProfile.findUnique.mockResolvedValue({
        id: 'learner-1',
        user: { email: 'a@b.com' },
      });
      prisma.offering.findUnique.mockResolvedValue({ id: 'offering-1', monthlyPrice: '150.00' });
      prisma.paymentOrder.create.mockResolvedValue({ id: 'order-1', providerReference: 'ref-1' });
      provider.initializeCheckout.mockRejectedValue(new Error('network error'));

      await expect(service.initiateCheckout('learner-1', 'offering-1')).rejects.toThrow(
        'network error',
      );
      expect(prisma.paymentOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: PaymentStatus.FAILED } }),
      );
    });
  });

  const pendingOrder = {
    id: 'order-1',
    learnerId: 'learner-1',
    offeringId: 'offering-1',
    providerReference: 'ref-1',
    amountMinor: 15000,
    currency: 'ZAR',
    status: PaymentStatus.PENDING,
  };

  describe('confirmPayment', () => {
    it('grants exactly one SubscriptionAccess and marks the order PAID', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(pendingOrder);
      subscriptionAccessService.createWithinExistingLock.mockResolvedValue({ id: 'access-1' });

      await service.confirmPayment('ref-1', 15000, 'ZAR');

      expect(subscriptionAccessService.createWithinExistingLock).toHaveBeenCalledTimes(1);
      expect(prisma.paymentOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: PaymentStatus.PAID, subscriptionAccessId: 'access-1' },
        }),
      );
    });

    it('is idempotent — a duplicate confirmation for an already-PAID order grants no second access', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue({
        ...pendingOrder,
        status: PaymentStatus.PAID,
      });

      await service.confirmPayment('ref-1', 15000, 'ZAR');

      expect(subscriptionAccessService.createWithinExistingLock).not.toHaveBeenCalled();
      expect(prisma.paymentOrder.update).not.toHaveBeenCalled();
    });

    it('rejects a confirmation whose amount does not match the order (tamper/mismatch protection)', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(pendingOrder);

      await expect(service.confirmPayment('ref-1', 99999, 'ZAR')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(subscriptionAccessService.createWithinExistingLock).not.toHaveBeenCalled();
    });

    it('rejects a confirmation whose currency does not match the order', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(pendingOrder);

      await expect(service.confirmPayment('ref-1', 15000, 'USD')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(subscriptionAccessService.createWithinExistingLock).not.toHaveBeenCalled();
    });

    it('is a deterministic no-op (never throws, never grants access) confirming an order already in a terminal non-PAID state (e.g. FAILED) — Correction 5', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue({
        ...pendingOrder,
        status: PaymentStatus.FAILED,
      });

      await expect(service.confirmPayment('ref-1', 15000, 'ZAR')).resolves.toBeUndefined();
      expect(subscriptionAccessService.createWithinExistingLock).not.toHaveBeenCalled();
      expect(prisma.paymentOrder.update).not.toHaveBeenCalled();
    });

    it('rejects a forged confirmation for a reference with no matching order', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(null);

      await expect(service.confirmPayment('forged-ref', 15000, 'ZAR')).rejects.toThrow();
      expect(subscriptionAccessService.createWithinExistingLock).not.toHaveBeenCalled();
    });

    it('two simultaneous confirmations of the same payment grant exactly one SubscriptionAccess (Correction 2)', async () => {
      // Models the advisory lock's real effect: concurrent calls to
      // confirmPayment each open a `$transaction`, and the lock serializes
      // them — this mock enforces that same serialization (one
      // transaction body runs to completion before the next starts)
      // rather than letting Jest's microtask interleaving race them.
      let queue = Promise.resolve();
      prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) => {
        const run = queue.then(() => fn(prisma));
        queue = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      });

      const order: { status: PaymentStatus; subscriptionAccessId?: string } = {
        ...pendingOrder,
      };
      prisma.paymentOrder.findUnique.mockImplementation(() => Promise.resolve({ ...order }));
      prisma.paymentOrder.update.mockImplementation(
        ({ data }: { data: { status: PaymentStatus; subscriptionAccessId: string } }) => {
          order.status = data.status;
          order.subscriptionAccessId = data.subscriptionAccessId;
          return Promise.resolve(order);
        },
      );
      subscriptionAccessService.createWithinExistingLock.mockResolvedValue({ id: 'access-1' });

      await Promise.all([
        service.confirmPayment('ref-1', 15000, 'ZAR'),
        service.confirmPayment('ref-1', 15000, 'ZAR'),
      ]);

      expect(subscriptionAccessService.createWithinExistingLock).toHaveBeenCalledTimes(1);
      expect(order.status).toBe(PaymentStatus.PAID);
    });
  });

  describe('failPayment', () => {
    it('marks a PENDING order FAILED', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: PaymentStatus.PENDING,
      });

      await service.failPayment('ref-1');

      expect(prisma.paymentOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: PaymentStatus.FAILED } }),
      );
    });

    it('never downgrades an already-PAID order (PAID wins over a later-arriving failure event) — Correction 5', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: PaymentStatus.PAID,
      });

      await service.failPayment('ref-1');

      expect(prisma.paymentOrder.update).not.toHaveBeenCalled();
    });

    it('is a no-op for an unknown/forged reference', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(null);

      await expect(service.failPayment('forged-ref')).resolves.toBeUndefined();
      expect(prisma.paymentOrder.update).not.toHaveBeenCalled();
    });
  });

  describe('success-vs-failure terminal-state serialization (Correction 5)', () => {
    it('confirmPayment and failPayment share the same payment-order lock — a success followed by a failure event never downgrades the grant', async () => {
      const order: { status: PaymentStatus; subscriptionAccessId?: string } = {
        ...pendingOrder,
      };
      prisma.paymentOrder.findUnique.mockImplementation(() => Promise.resolve({ ...order }));
      prisma.paymentOrder.update.mockImplementation(
        ({ data }: { data: { status: PaymentStatus; subscriptionAccessId?: string } }) => {
          Object.assign(order, data);
          return Promise.resolve(order);
        },
      );
      subscriptionAccessService.createWithinExistingLock.mockResolvedValue({ id: 'access-1' });

      await service.confirmPayment('ref-1', 15000, 'ZAR');
      expect(order.status).toBe(PaymentStatus.PAID);

      await service.failPayment('ref-1');

      expect(order.status).toBe(PaymentStatus.PAID);
      expect(subscriptionAccessService.createWithinExistingLock).toHaveBeenCalledTimes(1);
    });

    it('a failure event followed by a late success event never grants access — the first terminal event wins deterministically', async () => {
      const order: { status: PaymentStatus } = { ...pendingOrder };
      prisma.paymentOrder.findUnique.mockImplementation(() => Promise.resolve({ ...order }));
      prisma.paymentOrder.update.mockImplementation(
        ({ data }: { data: { status: PaymentStatus } }) => {
          Object.assign(order, data);
          return Promise.resolve(order);
        },
      );

      await service.failPayment('ref-1');
      expect(order.status).toBe(PaymentStatus.FAILED);

      await service.confirmPayment('ref-1', 15000, 'ZAR');

      expect(order.status).toBe(PaymentStatus.FAILED);
      expect(subscriptionAccessService.createWithinExistingLock).not.toHaveBeenCalled();
    });

    it('a concurrent success and failure for the same order resolve to exactly one deterministic terminal state, never an undefined one', async () => {
      // Serializes both calls through the same lock-emulation queue used
      // by the Correction 2 concurrency test above.
      let queue = Promise.resolve();
      prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) => {
        const run = queue.then(() => fn(prisma));
        queue = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      });

      const order: { status: PaymentStatus; subscriptionAccessId?: string } = { ...pendingOrder };
      prisma.paymentOrder.findUnique.mockImplementation(() => Promise.resolve({ ...order }));
      prisma.paymentOrder.update.mockImplementation(
        ({ data }: { data: { status: PaymentStatus; subscriptionAccessId?: string } }) => {
          Object.assign(order, data);
          return Promise.resolve(order);
        },
      );
      subscriptionAccessService.createWithinExistingLock.mockResolvedValue({ id: 'access-1' });

      await Promise.all([
        service.confirmPayment('ref-1', 15000, 'ZAR'),
        service.failPayment('ref-1'),
      ]);

      // Whichever acquired the lock first decided the outcome — both
      // terminal states are individually valid depending on arrival
      // order, but it must be exactly one of them, never a mix (e.g.
      // FAILED with a subscriptionAccessId attached).
      expect([PaymentStatus.PAID, PaymentStatus.FAILED]).toContain(order.status);
      if (order.status === PaymentStatus.PAID) {
        expect(order.subscriptionAccessId).toBe('access-1');
      } else {
        expect(order.subscriptionAccessId).toBeUndefined();
      }
      expect(subscriptionAccessService.createWithinExistingLock).toHaveBeenCalledTimes(
        order.status === PaymentStatus.PAID ? 1 : 0,
      );
    });
  });
});
