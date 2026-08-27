import { Module } from '@nestjs/common';

import { LearnersController } from './learners.controller.js';
import { LearnersService } from './learners.service.js';

@Module({
  controllers: [LearnersController],
  providers: [LearnersService],
  exports: [LearnersService],
})
export class LearnersModule {}
