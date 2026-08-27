import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateCourseDto {
  @IsUUID()
  subjectId!: string;

  @IsUUID()
  gradeLevelId!: string;

  @IsUUID()
  academicTermId!: string;

  @IsUUID()
  primaryTeacherId!: string;

  @IsString()
  @MinLength(1, { message: 'title must not be empty' })
  @MaxLength(200)
  title!: string;
}
