import { Module } from '@nestjs/common';

import { AcademicTermsController } from './academic-terms.controller.js';
import { AcademicTermsService } from './academic-terms.service.js';

@Module({
  controllers: [AcademicTermsController],
  providers: [AcademicTermsService],
  exports: [AcademicTermsService],
})
export class AcademicTermsModule {}
