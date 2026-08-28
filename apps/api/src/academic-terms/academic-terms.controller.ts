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
import type { AcademicTerm } from '../generated/prisma/client.js';
import { AcademicTermsService } from './academic-terms.service.js';
import { CreateAcademicTermDto } from './dto/create-academic-term.dto.js';
import { UpdateAcademicTermDto } from './dto/update-academic-term.dto.js';

@Controller('admin/academic-terms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AcademicTermsController {
  constructor(private readonly academicTermsService: AcademicTermsService) {}

  @Post()
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateAcademicTermDto): Promise<AcademicTerm> {
    return this.academicTermsService.create(dto);
  }

  @Get()
  @Roles('ADMIN')
  findAll(): Promise<AcademicTerm[]> {
    return this.academicTermsService.findAll();
  }

  @Get(':id')
  @Roles('ADMIN')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AcademicTerm> {
    return this.academicTermsService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAcademicTermDto,
  ): Promise<AcademicTerm> {
    return this.academicTermsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.academicTermsService.remove(id);
  }
}
