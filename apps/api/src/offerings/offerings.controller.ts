import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { Offering } from '../generated/prisma/client.js';
import { OfferingsService } from './offerings.service.js';

@Controller('admin/offerings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class OfferingsController {
  constructor(private readonly offeringsService: OfferingsService) {}

  @Get()
  findAll(): Promise<Offering[]> {
    return this.offeringsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Offering> {
    return this.offeringsService.findOne(id);
  }
}
