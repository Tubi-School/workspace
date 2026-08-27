import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

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
import { PrismaModule } from './prisma/prisma.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { SubjectsModule } from './subjects/subjects.module.js';
import { SubscriptionAccessModule } from './subscription-access/subscription-access.module.js';
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
  ],
})
export class AppModule {}
