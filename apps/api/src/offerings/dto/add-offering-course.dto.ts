import { IsUUID } from 'class-validator';

export class AddOfferingCourseDto {
  @IsUUID()
  courseId!: string;
}
