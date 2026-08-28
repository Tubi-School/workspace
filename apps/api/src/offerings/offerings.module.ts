import { Module } from '@nestjs/common';

import { OfferingsController } from './offerings.controller.js';
import { OfferingsService } from './offerings.service.js';

@Module({
  controllers: [OfferingsController],
  providers: [OfferingsService],
  exports: [OfferingsService],
})
export class OfferingsModule {}
