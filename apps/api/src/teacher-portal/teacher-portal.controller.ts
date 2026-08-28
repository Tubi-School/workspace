import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthenticatedUser } from '../auth/types.js';
import type { CourseWithRelations } from '../courses/courses.service.js';
import type { SessionWithRelations } from '../sessions/sessions.service.js';
import type { TeacherWithUser } from '../teachers/teachers.service.js';
import { TeacherPortalService } from './teacher-portal.service.js';

/**
 * TEACHER-scoped self-service reads (Phase 3 external review, Correction
 * 1). Identity is always derived from the authenticated JWT
 * (`@CurrentUser()`), never from a path/query parameter — mirrors the
 * learner-portal module's own pattern.
 */
@Controller('teacher')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TEACHER')
export class TeacherPortalController {
  constructor(private readonly teacherPortalService: TeacherPortalService) {}

  @Get('me')
  getMyProfile(@CurrentUser() user: AuthenticatedUser): Promise<TeacherWithUser> {
    return this.teacherPortalService.getMyProfile(user.id);
  }

  @Get('courses')
  listMyCourses(@CurrentUser() user: AuthenticatedUser): Promise<CourseWithRelations[]> {
    return this.teacherPortalService.listMyCourses(user.id);
  }

  @Get('sessions')
  listMySessions(@CurrentUser() user: AuthenticatedUser): Promise<SessionWithRelations[]> {
    return this.teacherPortalService.listMySessions(user.id);
  }

  @Get('sessions/:id')
  getMySession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SessionWithRelations> {
    return this.teacherPortalService.getMySession(user.id, id);
  }
}
