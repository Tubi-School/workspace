import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma, type Offering } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AddOfferingCourseDto } from './dto/add-offering-course.dto.js';
import type { CreateOfferingDto } from './dto/create-offering.dto.js';
import type { UpdateOfferingDto } from './dto/update-offering.dto.js';

const offeringInclude = {
  courses: { include: { course: { select: { id: true, title: true } } } },
} satisfies Prisma.OfferingInclude;

export type OfferingWithCourses = Prisma.OfferingGetPayload<{ include: typeof offeringInclude }>;

/**
 * ADMIN administration of the sellable Offering catalog (Phase 5 section
 * 9 — the production launch review found no path at all for an ADMIN to
 * create the first genuine Offering without direct database access; this
 * closes that gap). Deliberately minimal: create, a narrow update (name/
 * price only — never `deliveryMode`, see `UpdateOfferingDto`), and
 * course attach/detach. No delete — an Offering that
 * `SubscriptionAccess`/`PaymentOrder` rows may already reference is never
 * removed, only left unused.
 */
@Injectable()
export class OfferingsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Offering[]> {
    return this.prisma.offering.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string): Promise<Offering> {
    const offering = await this.prisma.offering.findUnique({ where: { id } });

    if (!offering) {
      throw new NotFoundException(`Offering ${id} not found`);
    }

    return offering;
  }

  async findOneWithCourses(id: string): Promise<OfferingWithCourses> {
    const offering = await this.prisma.offering.findUnique({
      where: { id },
      include: offeringInclude,
    });

    if (!offering) {
      throw new NotFoundException(`Offering ${id} not found`);
    }

    return offering;
  }

  async create(dto: CreateOfferingDto): Promise<OfferingWithCourses> {
    if (dto.courseIds.length > 0) {
      await this.assertCoursesExist(dto.courseIds);
    }

    const created = await this.prisma.offering.create({
      data: {
        name: dto.name,
        deliveryMode: dto.deliveryMode,
        monthlyPrice: dto.monthlyPrice,
        courses: { create: dto.courseIds.map((courseId) => ({ courseId })) },
      },
      include: offeringInclude,
    });

    return created;
  }

  async update(id: string, dto: UpdateOfferingDto): Promise<Offering> {
    await this.findOne(id);

    return this.prisma.offering.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.monthlyPrice !== undefined ? { monthlyPrice: dto.monthlyPrice } : {}),
      },
    });
  }

  /** The `findUnique` pre-check below is a fast-path for the common
   * uncontended case (a clear error immediately, no wasted round trip to
   * `create`). It is NOT the source of correctness under concurrency —
   * two simultaneous requests can both pass the pre-check and then both
   * attempt the `create`. The composite-unique constraint on
   * `(offeringId, courseId)` is what actually prevents a duplicate row;
   * the `catch` below turns Prisma's P2002 violation from that race into
   * the same 409 a sequential duplicate attempt would get, rather than
   * letting a raw database error escape as a 500. */
  async addCourse(id: string, dto: AddOfferingCourseDto): Promise<OfferingWithCourses> {
    await this.findOne(id);
    await this.assertCoursesExist([dto.courseId]);

    const existing = await this.prisma.offeringCourse.findUnique({
      where: { offeringId_courseId: { offeringId: id, courseId: dto.courseId } },
    });

    if (existing) {
      throw new ConflictException(`Course ${dto.courseId} is already part of offering ${id}`);
    }

    try {
      await this.prisma.offeringCourse.create({ data: { offeringId: id, courseId: dto.courseId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Course ${dto.courseId} is already part of offering ${id}`);
      }
      throw error;
    }

    return this.findOneWithCourses(id);
  }

  /** Same reasoning as `addCourse`: the `findUnique` pre-check is a fast
   * path, not the correctness guarantee. If a concurrent request (or a
   * retried duplicate request) deletes the row first, Prisma's `delete`
   * raises P2025 ("record to delete does not exist") — caught below and
   * turned into the same 404 a sequential double-removal would get. */
  async removeCourse(id: string, courseId: string): Promise<OfferingWithCourses> {
    await this.findOne(id);

    const existing = await this.prisma.offeringCourse.findUnique({
      where: { offeringId_courseId: { offeringId: id, courseId } },
    });

    if (!existing) {
      throw new NotFoundException(`Course ${courseId} is not part of offering ${id}`);
    }

    try {
      await this.prisma.offeringCourse.delete({
        where: { offeringId_courseId: { offeringId: id, courseId } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException(`Course ${courseId} is not part of offering ${id}`);
      }
      throw error;
    }

    return this.findOneWithCourses(id);
  }

  private async assertCoursesExist(courseIds: string[]): Promise<void> {
    const found = await this.prisma.course.findMany({
      where: { id: { in: courseIds } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((c) => c.id));
    const missing = courseIds.filter((id) => !foundIds.has(id));

    if (missing.length > 0) {
      throw new NotFoundException(`Course(s) not found: ${missing.join(', ')}`);
    }
  }
}
