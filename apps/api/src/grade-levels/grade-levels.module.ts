import { Module } from '@nestjs/common';

import { GradeLevelsController } from './grade-levels.controller.js';
import { GradeLevelsService } from './grade-levels.service.js';

@Module({
  controllers: [GradeLevelsController],
  providers: [GradeLevelsService],
  exports: [GradeLevelsService],
})
export class GradeLevelsModule {}
