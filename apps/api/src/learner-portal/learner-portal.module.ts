import { Module } from '@nestjs/common';

import { AttendanceModule } from '../attendance/attendance.module.js';
import { LearnerPortalController } from './learner-portal.controller.js';
import { LearnerPortalService } from './learner-portal.service.js';

@Module({
  imports: [AttendanceModule],
  controllers: [LearnerPortalController],
  providers: [LearnerPortalService],
})
export class LearnerPortalModule {}
