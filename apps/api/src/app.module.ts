import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AcademicTermsModule } from './academic-terms/academic-terms.module.js';
import { AttendanceModule } from './attendance/attendance.module.js';
import { AuthModule } from './auth/auth.module.js';
import { validateEnvironment } from './config/environment.js';
import { CoursesModule } from './courses/courses.module.js';
import { EntitlementModule } from './entitlements/entitlement.module.js';
import { GradeLevelsModule } from './grade-levels/grade-levels.module.js';
import { HealthModule } from './health/health.module.js';
import { LearnerPortalModule } from './learner-portal/learner-portal.module.js';
import { LearnersModule } from './learners/learners.module.js';
import { OfferingsModule } from './offerings/offerings.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { SubjectsModule } from './subjects/subjects.module.js';
import { SubscriptionAccessModule } from './subscription-access/subscription-access.module.js';
import { TeacherPortalModule } from './teacher-portal/teacher-portal.module.js';
import { TeachersModule } from './teachers/teachers.module.js';

/**
 * Composition root.
 *
 * Every feature milestone adds exactly one module here. Cross-cutting
 * infrastructure (configuration, database) is registered once and exposed
 * globally so feature modules stay focused on their own domain.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Nest will not boot if the environment is invalid.
      validate: validateEnvironment,
      // Loaded in order of precedence; real deployments inject variables
      // directly and have no .env file at all.
      envFilePath: ['.env.local', '.env'],
    }),
    // Generous global default (every route not otherwise annotated) —
    // this is baseline abuse protection, not a per-endpoint policy.
    // AuthController.login carries its own stricter @Throttle override
    // (see auth.controller.ts) since credential-guessing is the one
    // endpoint worth a materially tighter limit.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    AuthModule,
    GradeLevelsModule,
    AcademicTermsModule,
    SubjectsModule,
    CoursesModule,
    TeachersModule,
    SessionsModule,
    LearnersModule,
    SubscriptionAccessModule,
    EntitlementModule,
    AttendanceModule,
    LearnerPortalModule,
    TeacherPortalModule,
    OfferingsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
