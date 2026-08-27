import { Module } from '@nestjs/common';

import { EntitlementService } from './entitlement.service.js';

@Module({
  providers: [EntitlementService],
  exports: [EntitlementService],
})
export class EntitlementModule {}
