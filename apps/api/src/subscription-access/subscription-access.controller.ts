import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { SubscriptionAccess } from '../generated/prisma/client.js';
import { CreateSubscriptionAccessDto } from './dto/create-subscription-access.dto.js';
import { UpdateSubscriptionAccessDto } from './dto/update-subscription-access.dto.js';
import { SubscriptionAccessService } from './subscription-access.service.js';

@Controller('admin/subscription-access')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class SubscriptionAccessController {
  constructor(private readonly subscriptionAccessService: SubscriptionAccessService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateSubscriptionAccessDto): Promise<SubscriptionAccess> {
    return this.subscriptionAccessService.create(dto);
  }

  @Get()
  findAll(): Promise<SubscriptionAccess[]> {
    return this.subscriptionAccessService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<SubscriptionAccess> {
    return this.subscriptionAccessService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubscriptionAccessDto,
  ): Promise<SubscriptionAccess> {
    return this.subscriptionAccessService.update(id, dto);
  }

  @Post(':id/revoke')
  revoke(@Param('id', ParseUUIDPipe) id: string): Promise<SubscriptionAccess> {
    return this.subscriptionAccessService.revoke(id);
  }
}
