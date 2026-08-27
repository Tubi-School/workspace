import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateSubjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'name must not be empty' })
  @MaxLength(100)
  name?: string;
}
