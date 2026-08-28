import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { NotificationsModule } from '../notifications/notifications.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JWT_ALGORITHM } from './jwt.constants.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';

@Module({
  imports: [
    PassportModule,
    NotificationsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        // Pinned explicitly rather than left to the library default, so a
        // token cannot be crafted with a different algorithm and accepted.
        // Must match the `algorithms` allow-list passed to JwtStrategy.
        signOptions: {
          algorithm: JWT_ALGORITHM,
          // `@nestjs/jwt`'s `expiresIn` type is a template-literal union
          // (e.g. "1d") rather than plain `string`. JWT_EXPIRES_IN is
          // validated by `environmentSchema` but not narrowed to that union
          // at the type level, so this single, well-understood cast bridges
          // the two.
          expiresIn: configService.getOrThrow<string>('JWT_EXPIRES_IN') as unknown as number,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
