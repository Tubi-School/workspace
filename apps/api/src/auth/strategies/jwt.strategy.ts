import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../prisma/prisma.service.js';
import { JWT_ALGORITHM } from '../jwt.constants.js';
import type { AuthenticatedUser, JwtPayload } from '../types.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
      // Explicit allow-list, matching AuthModule's signing algorithm. A
      // token signed with any other algorithm — including one an attacker
      // crafted to try to bypass verification — is rejected outright.
      algorithms: [JWT_ALGORITHM],
    });
  }

  /**
   * Runs on every authenticated request. Re-checking the database — rather
   * than trusting the token's claims for the whole of its lifetime — is what
   * lets a deactivated account lose access immediately instead of waiting
   * for its token to expire.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });

    if (!user || !user.isActive) {
      // Same message whether the account was deleted, deactivated, or never
      // existed — an authenticated caller learns nothing more specific.
      throw new UnauthorizedException('Invalid or expired session');
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
    };
  }
}
