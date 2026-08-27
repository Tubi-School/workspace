import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CreateTeacherDto } from './dto/create-teacher.dto.js';
import { UpdateTeacherDto } from './dto/update-teacher.dto.js';
import { TeachersService, type TeacherWithUser } from './teachers.service.js';

@Controller('admin/teachers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TeachersController {
  constructor(private readonly teachersService: TeachersService) {}

  @Post()
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTeacherDto): Promise<TeacherWithUser> {
    return this.teachersService.create(dto);
  }

  @Get()
  @Roles('ADMIN', 'TEACHER')
  findAll(): Promise<TeacherWithUser[]> {
    return this.teachersService.findAll();
  }

  @Get(':id')
  @Roles('ADMIN', 'TEACHER')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<TeacherWithUser> {
    return this.teachersService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeacherDto): Promise<TeacherWithUser> {
    return this.teachersService.update(id, dto);
  }
}
