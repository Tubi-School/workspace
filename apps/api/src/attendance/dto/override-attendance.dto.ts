import { IsEnum, IsISO8601, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

import { AttendanceStatus, CompletionMode } from '../../generated/prisma/client.js';

/**
 * Manual attendance correction. Exceptional and auditable — never a normal
 * teacher register (founder ruling; ADMIN-only in this phase). A reason is
 * always required; completionMode/completedAt are required together only
 * when the override sets PRESENT, and forbidden otherwise — the same
 * nullable-together invariant AttendanceRecord itself enforces.
 */
export class OverrideAttendanceDto {
  @IsEnum(AttendanceStatus)
  newStatus!: AttendanceStatus;

  @ValidateIf((dto: OverrideAttendanceDto) => dto.newStatus === AttendanceStatus.PRESENT)
  @IsEnum(CompletionMode)
  completionMode?: CompletionMode;

  @ValidateIf((dto: OverrideAttendanceDto) => dto.newStatus === AttendanceStatus.PRESENT)
  @IsISO8601()
  completedAt?: string;

  @IsString()
  @MinLength(1, { message: 'reason is required' })
  @MaxLength(1000)
  reason!: string;
}
