import { IsEnum } from 'class-validator';

import { TeacherRole } from '../../generated/prisma/client.js';

export class UpdateSessionTeacherDto {
  @IsEnum(TeacherRole)
  role!: TeacherRole;
}
