import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma, RoleName, type User } from '../generated/prisma/client.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { JwtPayload, SanitizedUser } from './types.js';

/** Cost factor for bcrypt hashing. 12 is the current widely-recommended
 * floor for production password storage as of this writing. */
const BCRYPT_SALT_ROUNDS = 12;

/** Generic message for every credential failure. Login and inactive-account
 * rejection must be indistinguishable to the caller — telling an attacker
 * "that email exists but the password is wrong" versus "no such account"
 * hands them a free account-enumeration oracle. */
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

const DUPLICATE_EMAIL_MESSAGE = 'An account with this email already exists';

/** Prisma's error code for a unique-constraint violation. */
const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

/**
 * Canonicalizes an email identifier before every lookup or write.
 *
 * Registration and login must apply the exact same rule, or
 * "Learner@Example.com " and "learner@example.com" would silently behave as
 * two different accounts depending on which endpoint happened to see which
 * casing/whitespace first.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Public self-registration.
   *
   * Always creates a LEARNER account. There is no code path — regardless of
   * what a request body contains — through which a public caller can create
   * a TEACHER or ADMIN account. See the Phase 2C completion report for the
   * founder-review item this reflects: TEACHER/ADMIN provisioning is
   * deliberately out of scope here and belongs to a later, non-public flow.
   */
  async register(dto: RegisterDto): Promise<SanitizedUser> {
    const email = normalizeEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      throw new ConflictException(DUPLICATE_EMAIL_MESSAGE);
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);

    let user: User;
    try {
      // The User and its LearnerProfile are created together, atomically —
      // exactly the same pattern Phase 2E's TeachersService uses for
      // User+TeacherProfile. A LEARNER User with no LearnerProfile would be
      // a state the rest of the domain (SubscriptionAccess,
      // SessionEntitlementSnapshot, AttendanceRecord — all keyed off
      // LearnerProfile, not User) cannot represent.
      user = await this.prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            email,
            passwordHash,
            fullName: dto.fullName,
            role: RoleName.LEARNER,
          },
        });

        await tx.learnerProfile.create({ data: { userId: createdUser.id } });

        return createdUser;
      });
    } catch (error) {
      // The findUnique check above narrows the window but does not close
      // it — two requests can both pass it before either writes. Prisma's
      // own unique-constraint violation is the authoritative guard; a
      // caller must see the same 409 either way, never a raw database
      // error.
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException(DUPLICATE_EMAIL_MESSAGE);
      }
      throw error;
    }

    // Best-effort — a notification-enqueue failure must never fail
    // registration itself (section N/O; Phase 4 external review
    // Correction 8 — the account was already committed above, so an
    // un-caught throw here would have reported registration as failed to
    // the caller despite it having genuinely succeeded). enqueue() only
    // ever writes one outbox row; delivery/retry is handled entirely by
    // NotificationDispatchScheduler.
    try {
      await this.notifications.enqueue('ACCOUNT_REGISTERED', user.id, { fullName: user.fullName });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to enqueue ACCOUNT_REGISTERED notification for user ${user.id}: ${message}`,
      );
    }

    return sanitizeUser(user);
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; user: SanitizedUser }> {
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Reject a non-existent account and an inactive one with the same
    // outcome and the same message — see INVALID_CREDENTIALS_MESSAGE.
    if (!user || !user.isActive) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload);

    return { accessToken, user: sanitizeUser(user) };
  }

  async findSanitizedById(userId: string): Promise<SanitizedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    return sanitizeUser(user);
  }
}

/** True for a Prisma unique-constraint violation (e.g. two concurrent
 * registrations racing on the same email) — the case `register` must fold
 * into the same 409 Conflict a pre-check would have produced. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
  );
}

/** The only function in this module allowed to read `passwordHash` off a
 * `User` row — every value that leaves the service goes through this. */
function sanitizeUser(user: User): SanitizedUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
