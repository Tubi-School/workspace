import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { CreateCourseDto } from './dto/create-course.dto.js';
import type { UpdateCourseDto } from './dto/update-course.dto.js';

/** Only the fields safe to expose about the primary teacher — deliberately
 * excludes the `user` relation entirely, so `passwordHash` can never reach
 * a Course response regardless of what `User` gains in the future. */
const courseInclude = {
  subject: true,
  gradeLevel: true,
  academicTerm: true,
  primaryTeacher: {
    select: { id: true, bio: true, createdAt: true, userId: true },
  },
} satisfies Prisma.CourseInclude;

export type CourseWithRelations = Prisma.CourseGetPayload<{ include: typeof courseInclude }>;

interface ResolvedCourseReferences {
  subjectId?: string;
  gradeLevelId?: string;
  academicTermId?: string;
  primaryTeacherId?: string;
}

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCourseDto): Promise<CourseWithRelations> {
    await this.assertReferencesExist(dto);

    return this.prisma.course.create({
      data: {
        subjectId: dto.subjectId,
        gradeLevelId: dto.gradeLevelId,
        academicTermId: dto.academicTermId,
        primaryTeacherId: dto.primaryTeacherId,
        title: dto.title,
      },
      include: courseInclude,
    });
  }

  findAll(): Promise<CourseWithRelations[]> {
    return this.prisma.course.findMany({ include: courseInclude, orderBy: { title: 'asc' } });
  }

  async findOne(id: string): Promise<CourseWithRelations> {
    const course = await this.prisma.course.findUnique({ where: { id }, include: courseInclude });

    if (!course) {
      throw new NotFoundException(`Course ${id} not found`);
    }

    return course;
  }

  async update(id: string, dto: UpdateCourseDto): Promise<CourseWithRelations> {
    await this.findOne(id);
    await this.assertReferencesExist(dto);

    return this.prisma.course.update({
      where: { id },
      data: {
        ...(dto.subjectId !== undefined ? { subjectId: dto.subjectId } : {}),
        ...(dto.gradeLevelId !== undefined ? { gradeLevelId: dto.gradeLevelId } : {}),
        ...(dto.academicTermId !== undefined ? { academicTermId: dto.academicTermId } : {}),
        ...(dto.primaryTeacherId !== undefined ? { primaryTeacherId: dto.primaryTeacherId } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
      },
      include: courseInclude,
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    const sessionsUsingIt = await this.prisma.session.count({ where: { courseId: id } });

    if (sessionsUsingIt > 0) {
      throw new ConflictException(
        `Course ${id} is referenced by ${sessionsUsingIt} session(s) and cannot be deleted`,
      );
    }

    await this.prisma.course.delete({ where: { id } });
  }

  /**
   * Confirms every referenced entity actually exists before Prisma is ever
   * asked to create/update a row against it. Prisma's own foreign-key
   * violation would otherwise surface as a generic database error.
   *
   * A malformed UUID never reaches this method — `@IsUUID()` on the DTO
   * rejects that at the validation layer with 400 Bad Request. By the time
   * this runs, every id is syntactically valid; if it nonetheless doesn't
   * resolve to a row, that is a 404 Not Found, not a 400 — the input was
   * well-formed, the entity it points to simply doesn't exist. Every
   * missing reference is named together in one response, rather than
   * failing on the first one found.
   */
  private async assertReferencesExist(dto: ResolvedCourseReferences): Promise<void> {
    const checks: Promise<string | null>[] = [];

    if (dto.subjectId !== undefined) {
      checks.push(
        this.prisma.subject
          .findUnique({ where: { id: dto.subjectId } })
          .then((found) => (found ? null : `subjectId ${dto.subjectId} does not exist`)),
      );
    }
    if (dto.gradeLevelId !== undefined) {
      checks.push(
        this.prisma.gradeLevel
          .findUnique({ where: { id: dto.gradeLevelId } })
          .then((found) => (found ? null : `gradeLevelId ${dto.gradeLevelId} does not exist`)),
      );
    }
    if (dto.academicTermId !== undefined) {
      checks.push(
        this.prisma.academicTerm
          .findUnique({ where: { id: dto.academicTermId } })
          .then((found) => (found ? null : `academicTermId ${dto.academicTermId} does not exist`)),
      );
    }
    if (dto.primaryTeacherId !== undefined) {
      checks.push(
        this.prisma.teacherProfile
          .findUnique({ where: { id: dto.primaryTeacherId } })
          .then((found) => (found ? null : `primaryTeacherId ${dto.primaryTeacherId} does not exist`)),
      );
    }

    const results = await Promise.all(checks);
    const problems = results.filter((problem): problem is string => problem !== null);

    if (problems.length > 0) {
      throw new NotFoundException(problems);
    }
  }
}
