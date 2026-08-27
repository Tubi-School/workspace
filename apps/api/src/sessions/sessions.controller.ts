import {
  Body,
  Controller,
  Delete,
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
import { AssignSessionTeacherDto } from './dto/assign-session-teacher.dto.js';
import { CreateSessionDto } from './dto/create-session.dto.js';
import { ReassignPrimaryTeacherDto } from './dto/reassign-primary-teacher.dto.js';
import { UpdateSessionDto } from './dto/update-session.dto.js';
import { UpdateSessionTeacherDto } from './dto/update-session-teacher.dto.js';
import { SessionsService, type SessionWithRelations } from './sessions.service.js';

@Controller('admin/sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateSessionDto): Promise<SessionWithRelations> {
    return this.sessionsService.create(dto);
  }

  @Get()
  @Roles('ADMIN', 'TEACHER')
  findAll(): Promise<SessionWithRelations[]> {
    return this.sessionsService.findAll();
  }

  @Get(':id')
  @Roles('ADMIN', 'TEACHER')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<SessionWithRelations> {
    return this.sessionsService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSessionDto,
  ): Promise<SessionWithRelations> {
    return this.sessionsService.update(id, dto);
  }

  @Post(':id/mark-live')
  @Roles('ADMIN')
  markLive(@Param('id', ParseUUIDPipe) id: string): Promise<SessionWithRelations> {
    return this.sessionsService.markLive(id);
  }

  @Post(':id/mark-ended')
  @Roles('ADMIN')
  markEnded(@Param('id', ParseUUIDPipe) id: string): Promise<SessionWithRelations> {
    return this.sessionsService.markEnded(id);
  }

  @Post(':id/cancel')
  @Roles('ADMIN')
  cancel(@Param('id', ParseUUIDPipe) id: string): Promise<SessionWithRelations> {
    return this.sessionsService.cancel(id);
  }

  @Get(':id/teachers')
  @Roles('ADMIN', 'TEACHER')
  listTeachers(@Param('id', ParseUUIDPipe) id: string): Promise<SessionWithRelations['teachers']> {
    return this.sessionsService.listTeachers(id);
  }

  @Post(':id/teachers')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  addTeacher(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignSessionTeacherDto,
  ): Promise<SessionWithRelations> {
    return this.sessionsService.addTeacher(id, dto);
  }

  @Patch(':id/teachers/:teacherId')
  @Roles('ADMIN')
  updateTeacherRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @Body() dto: UpdateSessionTeacherDto,
  ): Promise<SessionWithRelations> {
    return this.sessionsService.updateTeacherRole(id, teacherId, dto);
  }

  @Patch(':id/primary-teacher')
  @Roles('ADMIN')
  reassignPrimaryTeacher(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignPrimaryTeacherDto,
  ): Promise<SessionWithRelations> {
    return this.sessionsService.reassignPrimaryTeacher(id, dto);
  }

  @Delete(':id/teachers/:teacherId')
  @Roles('ADMIN')
  removeTeacher(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
  ): Promise<SessionWithRelations> {
    return this.sessionsService.removeTeacher(id, teacherId);
  }
}
