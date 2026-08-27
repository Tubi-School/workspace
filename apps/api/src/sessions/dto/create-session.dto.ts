import { ArrayUnique, IsArray, IsISO8601, IsOptional, IsUUID, IsUrl } from 'class-validator';

export class CreateSessionDto {
  @IsUUID()
  courseId!: string;

  /** Plain calendar date, e.g. "2026-07-01". Must match the academic-day
   * (Africa/Johannesburg) that `startTime` falls on. */
  @IsISO8601({ strict: true })
  sessionDate!: string;

  /** Full ISO 8601 instant, e.g. "2026-07-01T13:00:00Z". Always supply an
   * explicit UTC offset ('Z' or '+hh:mm') — this is stored as an absolute
   * instant, never reinterpreted in any timezone. */
  @IsISO8601()
  startTime!: string;

  @IsISO8601()
  endTime!: string;

  @IsUrl({ require_tld: false }, { message: 'liveMeetingUrl must be a valid URL' })
  liveMeetingUrl!: string;

  /** Links this session as the replacement for a CANCELED session. Optional
   * — most sessions are not replacements. */
  @IsOptional()
  @IsUUID()
  replacementForSessionId?: string;

  /** TeacherProfile ids to assign as ASSISTANT on creation, in addition to
   * the PRIMARY teacher defaulted from Course.primaryTeacherId. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  assistantTeacherIds?: string[];

  /** TeacherProfile ids to assign as SUBSTITUTE on creation. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  substituteTeacherIds?: string[];
}
