import { IsISO8601, IsUUID } from 'class-validator';

/**
 * Internal ingestion shape for a completed live-connection interval — the
 * seam a future Zoom adapter attaches to. ADMIN-only in this phase (there
 * is no separate "system" role yet); see the Phase 2F completion report.
 */
export class CreateLiveIntervalDto {
  @IsUUID()
  learnerId!: string;

  @IsISO8601()
  joinedAt!: string;

  @IsISO8601()
  leftAt!: string;
}
