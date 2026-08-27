import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import type { AcademicTerm } from '../generated/prisma/client.js';
import type { CreateAcademicTermDto } from './dto/create-academic-term.dto.js';
import type { UpdateAcademicTermDto } from './dto/update-academic-term.dto.js';

/** Throws unless `start` is strictly before `end`. A term with no duration,
 * or a reversed range, is a malformed academic period the frozen domain
 * design never intended to represent. */
function assertValidDateRange(start: Date, end: Date): void {
  if (start.getTime() >= end.getTime()) {
    throw new BadRequestException('startDate must be strictly before endDate');
  }
}

@Injectable()
export class AcademicTermsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAcademicTermDto): Promise<AcademicTerm> {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    assertValidDateRange(startDate, endDate);

    return this.prisma.academicTerm.create({
      data: {
        name: dto.name,
        startDate,
        endDate,
        // Omitting `timezone` entirely (rather than passing undefined) lets
        // Prisma apply the schema's own default of "Africa/Johannesburg".
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
      },
    });
  }

  findAll(): Promise<AcademicTerm[]> {
    return this.prisma.academicTerm.findMany({ orderBy: { startDate: 'asc' } });
  }

  async findOne(id: string): Promise<AcademicTerm> {
    const academicTerm = await this.prisma.academicTerm.findUnique({ where: { id } });

    if (!academicTerm) {
      throw new NotFoundException(`Academic term ${id} not found`);
    }

    return academicTerm;
  }

  async update(id: string, dto: UpdateAcademicTermDto): Promise<AcademicTerm> {
    const existing = await this.findOne(id);

    const nextStartDate =
      dto.startDate !== undefined ? new Date(dto.startDate) : existing.startDate;
    const nextEndDate = dto.endDate !== undefined ? new Date(dto.endDate) : existing.endDate;
    assertValidDateRange(nextStartDate, nextEndDate);

    return this.prisma.academicTerm.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.startDate !== undefined ? { startDate: nextStartDate } : {}),
        ...(dto.endDate !== undefined ? { endDate: nextEndDate } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    const coursesUsingIt = await this.prisma.course.count({ where: { academicTermId: id } });

    if (coursesUsingIt > 0) {
      throw new ConflictException(
        `Academic term ${id} is referenced by ${coursesUsingIt} course(s) and cannot be deleted`,
      );
    }

    await this.prisma.academicTerm.delete({ where: { id } });
  }
}
