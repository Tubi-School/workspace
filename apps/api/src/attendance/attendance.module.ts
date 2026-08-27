import { Module } from '@nestjs/common';

import { AttendanceAdminController } from './attendance-admin.controller.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { LiveAttendanceIntervalService } from './live-attendance.service.js';
import { RecordingService } from './recording.service.js';
import { WatchedIntervalService } from './watched-interval.service.js';
import { WindowExceptionService } from './window-exception.service.js';

@Module({
  controllers: [AttendanceController, AttendanceAdminController],
  providers: [
    AttendanceService,
    LiveAttendanceIntervalService,
    WatchedIntervalService,
    RecordingService,
    WindowExceptionService,
  ],
  exports: [AttendanceService, WatchedIntervalService, RecordingService],
})
export class AttendanceModule {}
