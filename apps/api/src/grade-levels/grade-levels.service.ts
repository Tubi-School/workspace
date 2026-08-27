import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import type { GradeLevel } from '../generated/prisma/client.js';
import type { CreateGradeLevelDto } from './dto/create-grade-level.dto.js';
import type { UpdateGradeLevelDto } from './dto/update-grade-level.dto.js';

@Injectable()
export class GradeLevelsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateGradeLevelDto): Promise<GradeLevel> {
    const existing = await this.prisma.gradeLevel.findUnique({ where: { name: dto.name } });

    if (existing) {
      throw new ConflictException(`A grade level named "${dto.name}" already exists`);
    }

    return this.prisma.gradeLevel.create({ data: { name: dto.name } });
  }

  findAll(): Promise<GradeLevel[]> {
    return this.prisma.gradeLevel.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string): Promise<GradeLevel> {
    const gradeLevel = await this.prisma.gradeLevel.findUnique({ where: { id } });

    if (!gradeLevel) {
      throw new NotFoundException(`Grade level ${id} not found`);
    }

    return gradeLevel;
  }

  async update(id: string, dto: UpdateGradeLevelDto): Promise<GradeLevel> {
    await this.findOne(id);

    if (dto.name !== undefined) {
      const conflicting = await this.prisma.gradeLevel.findUnique({ where: { name: dto.name } });

      if (conflicting && conflicting.id !== id) {
        throw new ConflictException(`A grade level named "${dto.name}" already exists`);
      }
    }

    return this.prisma.gradeLevel.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    const coursesUsingIt = await this.prisma.course.count({ where: { gradeLevelId: id } });

    if (coursesUsingIt > 0) {
      throw new ConflictException(
        `Grade level ${id} is referenced by ${coursesUsingIt} course(s) and cannot be deleted`,
      );
    }

    await this.prisma.gradeLevel.delete({ where: { id } });
  }
}
