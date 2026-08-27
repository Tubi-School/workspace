import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class UpdateCourseDto {
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsUUID()
  gradeLevelId?: string;

  @IsOptional()
  @IsUUID()
  academicTermId?: string;

  @IsOptional()
  @IsUUID()
  primaryTeacherId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'title must not be empty' })
  @MaxLength(200)
  title?: string;
}
