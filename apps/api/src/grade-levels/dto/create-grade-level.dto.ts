import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateGradeLevelDto {
  @IsString()
  @MinLength(1, { message: 'name must not be empty' })
  @MaxLength(100)
  name!: string;
}
