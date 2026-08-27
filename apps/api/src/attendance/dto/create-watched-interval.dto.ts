import { IsInt, Min } from 'class-validator';

/**
 * Learner-facing: the learner's own player reports the range it just
 * played. learnerId is never accepted here — it is always derived from the
 * authenticated token.
 */
export class CreateWatchedIntervalDto {
  @IsInt()
  @Min(0)
  startSecond!: number;

  @IsInt()
  @Min(0)
  endSecond!: number;
}
