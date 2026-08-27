import { IsDateString, IsEnum, IsOptional } from 'class-validator';

import { SubscriptionStatus } from '../../generated/prisma/client.js';

export class UpdateSubscriptionAccessDto {
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsOptional()
  @IsDateString()
  currentPeriodStart?: string;

  @IsOptional()
  @IsDateString()
  currentPeriodEnd?: string;
}
