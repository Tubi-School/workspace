import { Module } from '@nestjs/common';

import { ZoomProviderService } from './zoom-provider.service.js';

@Module({
  providers: [ZoomProviderService],
  exports: [ZoomProviderService],
})
export class ZoomModule {}
