import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { ExceptionReason } from '../../generated/prisma/client.js';

/**
 * learnerId omitted -> session-wide exception. learnerId set -> exception
 * for that one learner only. Never accepted from a learner themselves —
 * this entire resource is ADMIN-only mutation (founder ruling).
 */
export class CreateWindowExceptionDto {
  @IsOptional()
  @IsUUID()
  learnerId?: string;

  @IsEnum(ExceptionReason)
  reason!: ExceptionReason;

  @IsISO8601()
  extendedCutoffAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
