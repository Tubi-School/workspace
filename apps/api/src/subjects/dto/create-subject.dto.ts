import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSubjectDto {
  @IsString()
  @MinLength(1, { message: 'name must not be empty' })
  @MaxLength(100)
  name!: string;
}
