import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

import { SubscriptionStatus } from '../../generated/prisma/client.js';

/**
 * Grants a learner access to an Offering (and, through it, every Course
 * the Offering covers) for a time window. This is an ACCESS GRANT only —
 * it carries no payment/invoice/card data, deliberately. Payment
 * processing is out of scope for this phase and attaches to this model
 * later, from outside it.
 */
export class CreateSubscriptionAccessDto {
  @IsUUID()
  learnerId!: string;

  @IsUUID()
  offeringId!: string;

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsDateString()
  currentPeriodStart!: string;

  @IsDateString()
  currentPeriodEnd!: string;
}
