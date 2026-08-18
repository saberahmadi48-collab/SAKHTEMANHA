import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AccessTokenClaims } from '@bops/contracts';

import { PrismaService } from '../database/prisma.service';

/**
 * Validates the access token and establishes WHO the caller is — nothing more.
 *
 * Authorization (what they may do, and to which building) is deliberately NOT
 * here; it is resolved per request by ScopeService. Keeping the two apart is
 * what lets a revoked membership take effect immediately instead of lingering
 * until the token expires.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = configService.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      // Unreachable in practice — env validation runs first — but throwing here
      // guarantees we never fall back to a default/empty signing key.
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: AccessTokenClaims): Promise<{ userId: string }> {
    if (payload.typ !== 'access') {
      // Blocks presenting a refresh token as an access token.
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        status: true,
        tokenGeneration: true,
        lockedUntil: true,
        archivedAt: true,
      },
    });

    if (!user || user.archivedAt || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account is temporarily locked');
    }
    // Password change / forced logout bumps tokenGeneration, instantly
    // invalidating every token minted before it — no blacklist required.
    if (user.tokenGeneration !== payload.gen) {
      throw new UnauthorizedException('Token has been superseded');
    }

    return { userId: user.id };
  }
}
