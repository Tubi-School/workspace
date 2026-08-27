import { IsISO8601, IsOptional, IsUUID, IsUrl } from 'class-validator';

/**
 * Deliberately carries no `status`, `canceledAt`, or `replacementForSessionId`
 * field — those are mutated exclusively through the dedicated lifecycle
 * endpoints (mark-live, mark-ended, cancel) and at creation time, never
 * through a raw field update. Only permitted while the session is still
 * SCHEDULED — see SessionsService.update.
 */
export class UpdateSessionDto {
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  sessionDate?: string;

  @IsOptional()
  @IsISO8601()
  startTime?: string;

  @IsOptional()
  @IsISO8601()
  endTime?: string;

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'liveMeetingUrl must be a valid URL' })
  liveMeetingUrl?: string;
}
