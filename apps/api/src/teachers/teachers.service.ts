import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

import { Prisma, RoleName } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateTeacherDto } from './dto/create-teacher.dto.js';
import type { UpdateTeacherDto } from './dto/update-teacher.dto.js';

/** Same standard as AuthService — see apps/api/src/auth/auth.service.ts. */
const BCRYPT_SALT_ROUNDS = 12;
const DUPLICATE_EMAIL_MESSAGE = 'An account with this email already exists';
const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

/** Same rule as AuthService.register/login — trim + lowercase, applied
 * identically everywhere an email is looked up or stored. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
  );
}

/** Only the fields safe to expose about the underlying User — deliberately
 * excludes passwordHash, exactly like AuthService's sanitizeUser. */
const teacherInclude = {
  user: {
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.TeacherProfileInclude;

export type TeacherWithUser = Prisma.TeacherProfileGetPayload<{ include: typeof teacherInclude }>;

@Injectable()
export class TeachersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Controlled ADMIN-only teacher provisioning.
   *
   * Creates the User (role TEACHER) and its TeacherProfile atomically — a
   * TeacherProfile without a User, or a TEACHER User without a profile,
   * would both be invalid states the rest of the domain doesn't expect.
   * There is no delete endpoint on this service: a Course or SessionTeacher
   * row can reference a TeacherProfile at any time, so removing one would
   * either have to cascade destructively (never done in this codebase — see
   * Phase 2D's deletion-safety convention) or leave dangling references.
   * `User.isActive = false`, via `update`, is the supported way to revoke a
   * teacher's access without destroying historical assignments.
   */
  async create(dto: CreateTeacherDto): Promise<TeacherWithUser> {
    const email = normalizeEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      throw new ConflictException(DUPLICATE_EMAIL_MESSAGE);
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            fullName: dto.fullName,
            role: RoleName.TEACHER,
          },
        });

        return tx.teacherProfile.create({
          data: { userId: user.id, bio: dto.bio ?? null },
          include: teacherInclude,
        });
      });
    } catch (error) {
      // Same race the Phase 2C AuthService hardening closed for public
      // registration: the pre-check narrows the window but doesn't close
      // it, so Prisma's own unique-constraint violation is the
      // authoritative guard.
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException(DUPLICATE_EMAIL_MESSAGE);
      }
      throw error;
    }
  }

  findAll(): Promise<TeacherWithUser[]> {
    return this.prisma.teacherProfile.findMany({ include: teacherInclude, orderBy: { createdAt: 'asc' } });
  }

  async findOne(id: string): Promise<TeacherWithUser> {
    const teacher = await this.prisma.teacherProfile.findUnique({ where: { id }, include: teacherInclude });

    if (!teacher) {
      throw new NotFoundException(`Teacher ${id} not found`);
    }

    return teacher;
  }

  async update(id: string, dto: UpdateTeacherDto): Promise<TeacherWithUser> {
    const existing = await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      if (dto.fullName !== undefined || dto.isActive !== undefined) {
        await tx.user.update({
          where: { id: existing.user.id },
          data: {
            ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
        });
      }

      if (dto.bio !== undefined) {
        await tx.teacherProfile.update({ where: { id }, data: { bio: dto.bio } });
      }

      return tx.teacherProfile.findUniqueOrThrow({ where: { id }, include: teacherInclude });
    });
  }
}
