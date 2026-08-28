import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthenticatedUser } from '../auth/types.js';
import type { Offering, PaymentOrder } from '../generated/prisma/client.js';
import { LearnerPortalService } from '../learner-portal/learner-portal.service.js';
import { OfferingsService } from '../offerings/offerings.service.js';
import { CheckoutDto } from './dto/checkout.dto.js';
import { PaymentsService } from './payments.service.js';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly learnerPortalService: LearnerPortalService,
    private readonly offeringsService: OfferingsService,
  ) {}

  /** Learner-facing commercial discovery (section R) — the same
   * Offering rows ADMIN already reads, exposed read-only to any
   * authenticated LEARNER so onboarding can show what's available
   * before a subscription exists. */
  @Get('learner/offerings')
  @Roles('LEARNER')
  listOfferings(): Promise<Offering[]> {
    return this.offeringsService.findAll();
  }

  @Post('learner/payments/checkout')
  @Roles('LEARNER')
  async checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CheckoutDto,
  ): Promise<{ checkoutUrl: string }> {
    const learnerId = await this.learnerPortalService.resolveLearnerProfileId(user.id);
    return this.paymentsService.initiateCheckout(learnerId, dto.offeringId);
  }

  /** Launch-console visibility into payment status (section W) — no
   * mutation, since a payment's true state may only ever be changed by a
   * verified provider webhook. */
  @Get('admin/payments')
  @Roles('ADMIN')
  listAll(): Promise<PaymentOrder[]> {
    return this.paymentsService.listAll();
  }
}
