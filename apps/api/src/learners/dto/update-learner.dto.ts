import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Mirrors Phase 2E's UpdateTeacherDto: no email/password change here —
 * credential rotation is a separate concern. isActive is the supported way
 * to deactivate a learner without deleting historical records.
 */
export class UpdateLearnerDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'fullName must not be empty' })
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
