import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import type { Subject } from '../generated/prisma/client.js';
import type { CreateSubjectDto } from './dto/create-subject.dto.js';
import type { UpdateSubjectDto } from './dto/update-subject.dto.js';

@Injectable()
export class SubjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSubjectDto): Promise<Subject> {
    const existing = await this.prisma.subject.findUnique({ where: { name: dto.name } });

    if (existing) {
      throw new ConflictException(`A subject named "${dto.name}" already exists`);
    }

    return this.prisma.subject.create({ data: { name: dto.name } });
  }

  findAll(): Promise<Subject[]> {
    return this.prisma.subject.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string): Promise<Subject> {
    const subject = await this.prisma.subject.findUnique({ where: { id } });

    if (!subject) {
      throw new NotFoundException(`Subject ${id} not found`);
    }

    return subject;
  }

  async update(id: string, dto: UpdateSubjectDto): Promise<Subject> {
    await this.findOne(id);

    if (dto.name !== undefined) {
      const conflicting = await this.prisma.subject.findUnique({ where: { name: dto.name } });

      if (conflicting && conflicting.id !== id) {
        throw new ConflictException(`A subject named "${dto.name}" already exists`);
      }
    }

    return this.prisma.subject.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    const coursesUsingIt = await this.prisma.course.count({ where: { subjectId: id } });

    if (coursesUsingIt > 0) {
      throw new ConflictException(
        `Subject ${id} is referenced by ${coursesUsingIt} course(s) and cannot be deleted`,
      );
    }

    await this.prisma.subject.delete({ where: { id } });
  }
}
