import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ListNotificationsDto } from './dto/list-notifications.dto.js';
import {
  NotificationsService,
  type NotificationOutboxItemWithRecipient,
} from './notifications.service.js';

/**
 * Minimum ADMIN visibility into the notification outbox (Phase 5 section
 * 15) — never a marketing/campaign surface. Retry only ever moves a FAILED
 * row back to PENDING for the existing fenced dispatcher to reclaim; this
 * controller never sends anything itself.
 */
@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(@Query() query: ListNotificationsDto): Promise<NotificationOutboxItemWithRecipient[]> {
    return this.notificationsService.listAll(query.status);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  retry(@Param('id', ParseUUIDPipe) id: string): Promise<NotificationOutboxItemWithRecipient> {
    return this.notificationsService.retryFailed(id);
  }
}
