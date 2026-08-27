import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAcademicTermDto {
  @IsString()
  @MinLength(1, { message: 'name must not be empty' })
  @MaxLength(200)
  name!: string;

  @IsDateString({ strict: true }, { message: 'startDate must be a valid ISO date (YYYY-MM-DD)' })
  startDate!: string;

  @IsDateString({ strict: true }, { message: 'endDate must be a valid ISO date (YYYY-MM-DD)' })
  endDate!: string;

  /** Defaults to Africa/Johannesburg — the frozen canonical school
   * timezone — when omitted, via the Prisma schema's own column default. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  timezone?: string;
}
