import { IsEnum, IsUUID } from 'class-validator';

import { TeacherRole } from '../../generated/prisma/client.js';

export class AssignSessionTeacherDto {
  @IsUUID()
  teacherId!: string;

  @IsEnum(TeacherRole)
  role!: TeacherRole;
}
