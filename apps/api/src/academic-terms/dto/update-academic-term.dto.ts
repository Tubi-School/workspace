import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateAcademicTermDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'name must not be empty' })
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'startDate must be a valid ISO date (YYYY-MM-DD)' })
  startDate?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'endDate must be a valid ISO date (YYYY-MM-DD)' })
  endDate?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  timezone?: string;
}
