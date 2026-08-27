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
import type { GradeLevel } from '../generated/prisma/client.js';
import { CreateGradeLevelDto } from './dto/create-grade-level.dto.js';
import { UpdateGradeLevelDto } from './dto/update-grade-level.dto.js';
import { GradeLevelsService } from './grade-levels.service.js';

@Controller('admin/grade-levels')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GradeLevelsController {
  constructor(private readonly gradeLevelsService: GradeLevelsService) {}

  @Post()
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateGradeLevelDto): Promise<GradeLevel> {
    return this.gradeLevelsService.create(dto);
  }

  @Get()
  @Roles('ADMIN', 'TEACHER')
  findAll(): Promise<GradeLevel[]> {
    return this.gradeLevelsService.findAll();
  }

  @Get(':id')
  @Roles('ADMIN', 'TEACHER')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<GradeLevel> {
    return this.gradeLevelsService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGradeLevelDto): Promise<GradeLevel> {
    return this.gradeLevelsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.gradeLevelsService.remove(id);
  }
}
