import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/environment.js';
import { PaymentStatus, type PaymentOrder } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { withAdvisoryLock } from '../common/pg-advisory-lock.util.js';
import { SubscriptionAccessService } from '../subscription-access/subscription-access.service.js';
import { PAYMENT_PROVIDER } from './payments.constants.js';
import type { PaymentProvider } from './payment-provider.interface.js';

const ZAR_MINOR_UNITS_PER_MAJOR = 100;

/**
 * The commercial layer upstream of SubscriptionAccess (section K). A
 * PaymentOrder never becomes a payment ledger — it is exactly the fields
 * needed to initiate a checkout, verify a provider's confirmation, and
 * grant access exactly once. SubscriptionAccess's own concurrency
 * protection (Phase 2G's advisory-lock create()) remains the sole
 * authority for the grant itself; this service never duplicates it.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly subscriptionAccessService: SubscriptionAccessService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.provider.isConfigured() && this.config.get('PAYMENTS_CALLBACK_URL', { infer: true }),
    );
  }

  /**
   * A client redirect claiming success is never sufficient (section L) —
   * this method exists only to hand the learner a real provider checkout
   * URL. Access is granted later, exclusively by `confirmPayment`, which
   * only a verified provider webhook ever calls.
   */
  async initiateCheckout(learnerId: string, offeringId: string): Promise<{ checkoutUrl: string }> {
    if (!this.isConfigured()) {
      throw new ConflictException(
        `Payments are not configured yet (${this.provider.name} credentials missing) — checkout is unavailable`,
      );
    }

    const learner = await this.prisma.learnerProfile.findUnique({
      where: { id: learnerId },
      include: { user: true },
    });
    if (!learner) {
      throw new NotFoundException(`Learner ${learnerId} not found`);
    }

    const offering = await this.prisma.offering.findUnique({ where: { id: offeringId } });
    if (!offering) {
      throw new NotFoundException(`Offering ${offeringId} not found`);
    }

    const amountMinor = Math.round(Number(offering.monthlyPrice) * ZAR_MINOR_UNITS_PER_MAJOR);
    const providerReference = `tubi-${learnerId}-${Date.now()}`;

    const order = await this.prisma.paymentOrder.create({
      data: {
        learnerId,
        offeringId,
        provider: this.provider.name,
        providerReference,
        amountMinor,
        currency: 'ZAR',
        status: PaymentStatus.PENDING,
      },
    });

    const callbackUrl = this.config.get('PAYMENTS_CALLBACK_URL', { infer: true })!;

    try {
      const result = await this.provider.initializeCheckout({
        providerReference: order.providerReference!,
        email: learner.user.email,
        amountMinor,
        currency: 'ZAR',
        callbackUrl,
      });
      return result;
    } catch (error) {
      await this.prisma.paymentOrder.update({
        where: { id: order.id },
        data: { status: PaymentStatus.FAILED },
      });
      throw error;
    }
  }

  /**
   * Called only from a verified, idempotency-claimed provider webhook
   * (section L). Amount/currency must match the order exactly — a
   * tampered/forged confirmation for the wrong amount is rejected outright
   * rather than granting access anyway.
   *
   * Phase 4 external review Correction 2: the access grant and the order's
   * PAID transition are one Postgres transaction — either both commit or
   * neither does. A crash between them (the failure mode the review
   * identified: access granted but the order left PENDING forever) is no
   * longer reachable, because there is no longer a "between" from the
   * database's perspective. An advisory lock on the order's own reference
   * is held for the duration of that transaction, so two concurrent
   * deliveries of the same confirmation serialize — the second one blocks
   * until the first commits, then sees PAID and returns immediately. The
   * grant itself still goes through `SubscriptionAccessService`'s own
   * concurrency-safe validation/overlap-check
   * (`createWithinExistingLock`) — that logic is reused here, not
   * duplicated — under the *same* `subscription-access:{learnerId}:
   * {offeringId}` advisory lock key that method's standalone `create()`
   * would otherwise take for itself.
   */
  async confirmPayment(
    providerReference: string,
    amountMinor: number,
    currency: string,
  ): Promise<void> {
    await withAdvisoryLock(this.prisma, `payment-order:${providerReference}`, async (tx) => {
      const order = await tx.paymentOrder.findUnique({ where: { providerReference } });

      if (!order) {
        throw new NotFoundException(`No payment order for reference ${providerReference}`);
      }

      if (order.status === PaymentStatus.PAID) {
        return; // Idempotent no-op — already granted, same transaction, no writes.
      }

      if (order.status !== PaymentStatus.PENDING) {
        // Phase 4 external review Correction 5: a terminal state
        // (FAILED/CANCELED/REFUNDED) reached by an earlier `failPayment`
        // call — which shares this exact `payment-order:{reference}`
        // advisory lock — is itself terminal. Provider event *arrival
        // order* determines the outcome deterministically (whichever
        // terminal event wins the lock first), but once decided, a
        // later-arriving contradictory event is a safe, logged no-op —
        // never an exception that would leave the webhook's own retry
        // machinery hammering an order that will never become PENDING
        // again, and never a silent grant of access to an order this
        // school already recorded as failed.
        this.logger.warn(
          `confirmPayment received for order ${order.id} already in terminal state ${order.status} — ignoring (first terminal event wins).`,
        );
        return;
      }

      if (order.amountMinor !== amountMinor || order.currency !== currency) {
        throw new BadRequestException(
          `Payment confirmation amount/currency mismatch for order ${order.id}`,
        );
      }

      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      // Acquire the exact lock key SubscriptionAccessService.create()
      // would take for itself, inside this same transaction, so the grant
      // and the order update below commit atomically together.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscription-access:${order.learnerId}:${order.offeringId}`})::bigint)`;

      const access = await this.subscriptionAccessService.createWithinExistingLock(tx, {
        learnerId: order.learnerId,
        offeringId: order.offeringId,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
      });

      await tx.paymentOrder.update({
        where: { id: order.id },
        data: { status: PaymentStatus.PAID, subscriptionAccessId: access.id },
      });
    });
  }

  /**
   * Phase 4 external review Correction 5: shares the exact same
   * `payment-order:{reference}` advisory lock and transaction policy as
   * `confirmPayment` — a `charge.success` and a `charge.failed` for the
   * same order can never race each other; whichever acquires the lock
   * first decides the order's one terminal state, and the other is a
   * deterministic, logged no-op once it sees that state.
   */
  async failPayment(providerReference: string): Promise<void> {
    await withAdvisoryLock(this.prisma, `payment-order:${providerReference}`, async (tx) => {
      const order = await tx.paymentOrder.findUnique({ where: { providerReference } });

      if (!order) {
        return; // Unknown/forged reference — nothing to do.
      }

      if (order.status !== PaymentStatus.PENDING) {
        if (order.status !== PaymentStatus.FAILED) {
          this.logger.warn(
            `failPayment received for order ${order.id} already in terminal state ${order.status} — ignoring (first terminal event wins).`,
          );
        }
        return; // PAID (or already FAILED) wins — never downgrades a granted access.
      }

      await tx.paymentOrder.update({
        where: { id: order.id },
        data: { status: PaymentStatus.FAILED },
      });
    });
  }

  listAll(): Promise<PaymentOrder[]> {
    return this.prisma.paymentOrder.findMany({ orderBy: { createdAt: 'desc' } });
  }
}
