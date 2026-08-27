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
import type { Subject } from '../generated/prisma/client.js';
import { CreateSubjectDto } from './dto/create-subject.dto.js';
import { UpdateSubjectDto } from './dto/update-subject.dto.js';
import { SubjectsService } from './subjects.service.js';

@Controller('admin/subjects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  @Post()
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateSubjectDto): Promise<Subject> {
    return this.subjectsService.create(dto);
  }

  @Get()
  @Roles('ADMIN', 'TEACHER')
  findAll(): Promise<Subject[]> {
    return this.subjectsService.findAll();
  }

  @Get(':id')
  @Roles('ADMIN', 'TEACHER')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Subject> {
    return this.subjectsService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSubjectDto): Promise<Subject> {
    return this.subjectsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.subjectsService.remove(id);
  }
}
