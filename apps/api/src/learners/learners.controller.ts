import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { UpdateLearnerDto } from './dto/update-learner.dto.js';
import { LearnersService, type LearnerWithUser } from './learners.service.js';

/**
 * ADMIN-only — this is the operational directory used to grant
 * SubscriptionAccess, not a learner-facing surface. Learners read their own
 * data through the /learner/* routes in the learner-portal module, which
 * derive identity from the authenticated token rather than a supplied id.
 */
@Controller('admin/learners')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class LearnersController {
  constructor(private readonly learnersService: LearnersService) {}

  @Get()
  findAll(): Promise<LearnerWithUser[]> {
    return this.learnersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<LearnerWithUser> {
    return this.learnersService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLearnerDto,
  ): Promise<LearnerWithUser> {
    return this.learnersService.update(id, dto);
  }
}
