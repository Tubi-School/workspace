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
import type { Offering } from '../generated/prisma/client.js';
import { AddOfferingCourseDto } from './dto/add-offering-course.dto.js';
import { CreateOfferingDto } from './dto/create-offering.dto.js';
import { UpdateOfferingDto } from './dto/update-offering.dto.js';
import { OfferingsService, type OfferingWithCourses } from './offerings.service.js';

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
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<OfferingWithCourses> {
    return this.offeringsService.findOneWithCourses(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateOfferingDto): Promise<OfferingWithCourses> {
    return this.offeringsService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOfferingDto,
  ): Promise<Offering> {
    return this.offeringsService.update(id, dto);
  }

  @Post(':id/courses')
  @HttpCode(HttpStatus.CREATED)
  addCourse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddOfferingCourseDto,
  ): Promise<OfferingWithCourses> {
    return this.offeringsService.addCourse(id, dto);
  }

  @Delete(':id/courses/:courseId')
  removeCourse(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ): Promise<OfferingWithCourses> {
    return this.offeringsService.removeCourse(id, courseId);
  }
}
