import { Module } from '@nestjs/common';

import { TeacherPortalController } from './teacher-portal.controller.js';
import { TeacherPortalService } from './teacher-portal.service.js';

@Module({
  controllers: [TeacherPortalController],
  providers: [TeacherPortalService],
})
export class TeacherPortalModule {}
