import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import type { AccessTokenClaims, RefreshTokenClaims } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { normalizeIranianMobile } from '../../common/validators/iranian.validators';
import type {
  AuthTokensResponse,
  CurrentUserResponse,
  LoginDto,
  RegisterDto,
} from './dto/auth.dto';

/**
 * Authentication: registration, login, refresh-token rotation, logout.
 *
 * This is the entry point of BM-01 §32 onboarding — everything downstream
 * (organization, building, unit) requires an authenticated principal, and the
 * global guards have nothing to verify until this service mints a token.
 *
 * SECURITY PROPERTIES, each deliberate:
 *
 *  - LOGIN IS UNIFORM. Wrong password, unknown user, and disabled account all
 *    return the same Persian message and take comparable time (a dummy bcrypt
 *    compare runs when no user is found), so the endpoint cannot be used to
 *    enumerate which emails or phone numbers are registered.
 *
 *  - REFRESH TOKENS ROTATE AND DETECT REPLAY. Each refresh revokes the token
 *    presented and issues a new one. Presenting an already-rotated token means
 *    it was stolen, so the whole family is killed and `tokenGeneration` is
 *    bumped, invalidating every access token the thief holds too.
 *
 *  - ONLY HASHES ARE STORED. The database holds sha256(refresh token) and a
 *    bcrypt password hash; a database leak yields no usable session.
 *
 *  - THE ACCESS TOKEN CARRIES NO AUTHORITY. Just `sub`, `gen`, `typ`. Roles and
 *    buildings are resolved per request by ScopeService, so revoking access
 *    takes effect immediately rather than at token expiry.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Pre-computed hash of a value nobody can supply, used to spend bcrypt time
   * on the "user not found" path. Without it, a missing user returns in ~1ms
   * and a wrong password in ~200ms — a trivially measurable account oracle.
   */
  private readonly dummyHash = bcrypt.hashSync('bops::nonexistent::user', 10);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates a User + Person pair (BM-01 §21: credentials and identity are
   * separate records) and returns a live session.
   *
   * Registration grants NO tenancy. A brand-new account can reach `/auth/me`
   * and nothing else until it creates an organization or accepts an invitation
   * — §33 forbids joining a building merely by knowing it exists.
   */
  async register(
    dto: RegisterDto,
    context: RequestContext,
  ): Promise<AuthTokensResponse> {
    const email = dto.email?.toLowerCase() ?? null;
    const phoneNumber = dto.phoneNumber
      ? (normalizeIranianMobile(dto.phoneNumber) ?? dto.phoneNumber)
      : null;

    await this.assertIdentifierAvailable(email, phoneNumber);

    const rounds = this.config.get<number>('PASSWORD_HASH_ROUNDS', 12);
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    // User and Person are created in one transaction: an account with no person
    // row would be invisible to every membership query and effectively broken.
    const user = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            phoneNumber,
            passwordHash,
            // Verification flows arrive in BM-07. Until then the account is
            // usable but explicitly marked as unverified rather than silently
            // treated as verified.
            status: 'ACTIVE',
            person: {
              create: {
                firstName: dto.firstName,
                lastName: dto.lastName,
                nationalId: dto.nationalId ?? null,
                email,
                phoneNumber,
              },
            },
          },
          select: { id: true, tokenGeneration: true, person: { select: { id: true } } },
        });
        return created;
      })
      .catch((error: unknown) => {
        // The unique indexes are the real authority on availability — the check
        // above only produces a friendlier message. Two concurrent signups with
        // the same email both pass that check and one must fail here.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(
            (error.meta?.target as string[] | undefined)?.includes('phoneNumber')
              ? ERRORS.phoneAlreadyRegistered
              : ERRORS.emailAlreadyRegistered,
          );
        }
        throw error;
      });

    await this.audit.logAs(
      { userId: user.id, personId: user.person?.id ?? null },
      {
        action: 'auth.user.registered',
        resourceType: 'User',
        resourceId: user.id,
        after: { email, phoneNumber },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    );

    return this.issueTokens(user.id, user.tokenGeneration, context);
  }

  /**
   * Verifies credentials and returns a session.
   *
   * Every failure path returns ERRORS.invalidCredentials. That includes a
   * disabled account: telling an attacker "this account exists but is
   * suspended" confirms the identifier is real.
   */
  async login(
    dto: LoginDto,
    context: RequestContext,
  ): Promise<AuthTokensResponse> {
    const user = await this.findByIdentifier(dto.identifier);

    if (!user || !user.passwordHash) {
      // Constant-ish work on the not-found path — see `dummyHash`.
      await bcrypt.compare(dto.password, this.dummyHash);
      throw new UnauthorizedException(ERRORS.invalidCredentials);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(ERRORS.accountLocked);
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts);
      throw new UnauthorizedException(ERRORS.invalidCredentials);
    }

    if (user.archivedAt || user.status !== 'ACTIVE') {
      throw new UnauthorizedException(ERRORS.invalidCredentials);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    await this.audit.logAs(
      { userId: user.id },
      {
        action: 'auth.session.started',
        resourceType: 'User',
        resourceId: user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    );

    return this.issueTokens(user.id, user.tokenGeneration, context);
  }

  /**
   * Rotates a refresh token: the presented token is revoked and a new pair is
   * issued.
   *
   * REPLAY DETECTION: a token that is already revoked but has a `replacedById`
   * was rotated legitimately once — seeing it again means someone else has a
   * copy. The response is to revoke every session for that user and bump
   * `tokenGeneration`, which also kills outstanding access tokens.
   */
  async refresh(
    presentedToken: string,
    context: RequestContext,
  ): Promise<AuthTokensResponse> {
    let claims: RefreshTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<RefreshTokenClaims>(presentedToken, {
        secret: this.requireSecret('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(ERRORS.refreshTokenInvalid);
    }

    if (claims.typ !== 'refresh') {
      // Blocks presenting an access token here to sidestep rotation tracking.
      throw new UnauthorizedException(ERRORS.refreshTokenInvalid);
    }

    const tokenHash = hashToken(presentedToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
        replacedById: true,
      },
    });

    if (!stored || stored.userId !== claims.sub) {
      throw new UnauthorizedException(ERRORS.refreshTokenInvalid);
    }

    if (stored.revokedAt) {
      if (stored.replacedById) {
        await this.handleTokenReuse(stored.userId, context);
        throw new UnauthorizedException(ERRORS.refreshTokenReused);
      }
      throw new UnauthorizedException(ERRORS.refreshTokenInvalid);
    }

    if (stored.expiresAt <= new Date()) {
      throw new UnauthorizedException(ERRORS.sessionExpired);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      select: {
        id: true,
        status: true,
        archivedAt: true,
        tokenGeneration: true,
      },
    });

    if (!user || user.archivedAt || user.status !== 'ACTIVE') {
      throw new UnauthorizedException(ERRORS.accountDisabled);
    }
    if (user.tokenGeneration !== claims.gen) {
      // Password changed or a forced logout happened after this token was cut.
      throw new UnauthorizedException(ERRORS.sessionExpired);
    }

    return this.issueTokens(user.id, user.tokenGeneration, context, stored.id);
  }

  /**
   * Ends a session. Revoking a specific token logs out one device; omitting it
   * revokes every live session for the user.
   *
   * Logout is idempotent and never reports whether the token existed — a
   * "logout failed" response would be useless to the client and informative to
   * an attacker probing token validity.
   */
  async logout(
    userId: string,
    presentedToken: string | undefined,
    context: RequestContext,
  ): Promise<void> {
    const now = new Date();

    if (presentedToken) {
      await this.prisma.refreshToken.updateMany({
        where: {
          tokenHash: hashToken(presentedToken),
          userId,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
    } else {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
    }

    await this.audit.logAs(
      { userId },
      {
        action: presentedToken ? 'auth.session.ended' : 'auth.sessions.ended_all',
        resourceType: 'User',
        resourceId: userId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    );
  }

  /**
   * Profile of the authenticated caller plus the organizations and buildings
   * they can actually reach — the data the client needs to render its tenant
   * switcher.
   *
   * IMPORTANT: this list is derived from live membership rows, so it is the
   * same source of truth ScopeService uses per request. It is a convenience for
   * the UI, never a grant: naming a building here still does not let a request
   * touch it without the guard re-proving access.
   */
  async getCurrentUser(userId: string): Promise<CurrentUserResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        status: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        person: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!user) {
      // Reachable only if the account was deleted between guard and handler.
      throw new UnauthorizedException(ERRORS.accountDisabled);
    }

    const personId = user.person?.id ?? null;
    const now = new Date();

    const [orgMemberships, buildingMemberships] = personId
      ? await Promise.all([
          this.prisma.organizationMembership.findMany({
            where: {
              personId,
              status: 'ACTIVE',
              OR: [{ endedAt: null }, { endedAt: { gt: now } }],
              organization: { archivedAt: null },
            },
            select: {
              role: true,
              organization: { select: { id: true, name: true } },
            },
          }),
          this.prisma.buildingMembership.findMany({
            where: {
              personId,
              status: 'ACTIVE',
              OR: [{ endedAt: null }, { endedAt: { gt: now } }],
              building: { archivedAt: null },
            },
            select: {
              role: true,
              building: {
                select: { id: true, name: true, organizationId: true },
              },
            },
          }),
        ])
      : [[], []];

    return {
      userId: user.id,
      personId,
      email: user.email,
      phoneNumber: user.phoneNumber,
      firstName: user.person?.firstName ?? null,
      lastName: user.person?.lastName ?? null,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
      phoneVerified: user.phoneVerifiedAt !== null,
      organizations: groupRoles(
        orgMemberships.map((m) => ({
          id: m.organization.id,
          name: m.organization.name,
          role: m.role,
        })),
      ),
      buildings: groupRoles(
        buildingMemberships.map((m) => ({
          id: m.building.id,
          name: m.building.name,
          organizationId: m.building.organizationId,
          role: m.role,
        })),
      ),
    };
  }

  // -------------------------------------------------------------------------
  //  internals
  // -------------------------------------------------------------------------

  /**
   * Mints an access/refresh pair and persists the refresh token's hash.
   *
   * When `rotatedFromId` is given the old row is revoked and linked to the new
   * one inside the same transaction, which is what makes replay detection
   * reliable: there is no window where both tokens are simultaneously valid.
   */
  private async issueTokens(
    userId: string,
    tokenGeneration: number,
    context: RequestContext,
    rotatedFromId?: string,
  ): Promise<AuthTokensResponse> {
    const sessionId = randomBytes(16).toString('hex');

    const accessClaims: AccessTokenClaims = {
      sub: userId,
      gen: tokenGeneration,
      typ: 'access',
    };
    const refreshClaims: RefreshTokenClaims = {
      sub: userId,
      gen: tokenGeneration,
      sid: sessionId,
      typ: 'refresh',
    };

    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL', '900s');
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL', '30d');

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessClaims, {
        secret: this.requireSecret('JWT_ACCESS_SECRET'),
        expiresIn: accessTtl,
      }),
      this.jwt.signAsync(refreshClaims, {
        secret: this.requireSecret('JWT_REFRESH_SECRET'),
        expiresIn: refreshTtl,
      }),
    ]);

    const expiresAt = new Date(Date.now() + durationToMs(refreshTtl));

    await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          userId,
          tokenHash: hashToken(refreshToken),
          expiresAt,
          userAgent: context.userAgent ?? null,
          ipAddress: context.ipAddress ?? null,
        },
        select: { id: true },
      });

      if (rotatedFromId) {
        await tx.refreshToken.update({
          where: { id: rotatedFromId },
          data: { revokedAt: new Date(), replacedById: created.id },
        });
      }
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(durationToMs(accessTtl) / 1000),
    };
  }

  /**
   * A rotated refresh token was presented again — treat it as theft.
   * Revoking the family alone is not enough: the thief may hold a valid access
   * token, so `tokenGeneration` is bumped, which JwtStrategy checks on every
   * request and which therefore invalidates them immediately.
   */
  private async handleTokenReuse(
    userId: string,
    context: RequestContext,
  ): Promise<void> {
    this.logger.warn(
      `Refresh token reuse detected for user=${userId} ip=${context.ipAddress ?? 'unknown'} — revoking all sessions`,
    );

    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { tokenGeneration: { increment: 1 } },
      }),
    ]);

    await this.audit.logAs(
      { userId },
      {
        action: 'auth.token.reuse_detected',
        resourceType: 'User',
        resourceId: userId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    );
  }

  /**
   * Counts a failed login and locks the account after a threshold.
   *
   * The lock is time-boxed rather than permanent on purpose: a permanent lock
   * turns a guessable identifier into a denial-of-service against a real user.
   */
  private async registerFailedAttempt(
    userId: string,
    currentAttempts: number,
  ): Promise<void> {
    const attempts = currentAttempts + 1;
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
      },
    });
  }

  /** Looks up an account by email or normalised phone number. */
  private async findByIdentifier(identifier: string) {
    const normalizedPhone = normalizeIranianMobile(identifier);
    const where: Prisma.UserWhereInput = normalizedPhone
      ? { phoneNumber: normalizedPhone }
      : { email: identifier.toLowerCase() };

    return this.prisma.user.findFirst({
      where,
      select: {
        id: true,
        passwordHash: true,
        status: true,
        archivedAt: true,
        lockedUntil: true,
        failedLoginAttempts: true,
        tokenGeneration: true,
      },
    });
  }

  /** Friendly pre-check; the unique indexes remain the real guarantee. */
  private async assertIdentifierAvailable(
    email: string | null,
    phoneNumber: string | null,
  ): Promise<void> {
    if (email) {
      const existing = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existing) throw new ConflictException(ERRORS.emailAlreadyRegistered);
    }
    if (phoneNumber) {
      const existing = await this.prisma.user.findUnique({
        where: { phoneNumber },
        select: { id: true },
      });
      if (existing) throw new ConflictException(ERRORS.phoneAlreadyRegistered);
    }
  }

  /**
   * Reads a signing secret, failing loudly if it is absent. Env validation makes
   * this unreachable, but falling back to a default signing key would be a
   * total authentication bypass, so it is never allowed to happen silently.
   */
  private requireSecret(key: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET'): string {
    const secret = this.config.get<string>(key);
    if (!secret) throw new Error(`${key} is not configured`);
    return secret;
  }
}

/** Request metadata attached to sessions and audit rows. */
export interface RequestContext {
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

/**
 * sha256 of a refresh token. Not bcrypt: the token is already 100+ bits of
 * signed randomness, so a slow KDF buys nothing and would add ~200ms to every
 * refresh. Only the hash is ever stored.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time string comparison, exported for callers that must compare a
 * user-supplied token against a stored value without leaking position through
 * timing. (Length differences are unavoidable and deliberately treated as an
 * immediate mismatch.)
 */
export function safeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Converts a JWT-style duration ("900s", "30d", "15m") to milliseconds.
 * Needed because the refresh token's DB expiry must match the one baked into
 * the JWT; deriving both from the same string keeps them from drifting.
 */
export function durationToMs(duration: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(duration.trim());
  if (!match) {
    // A malformed TTL silently becoming "1 second" would log everyone out, so
    // treat it as the configuration error it is.
    throw new Error(`Invalid duration format: ${duration}`);
  }
  const value = Number(match[1]);
  switch (match[2] ?? 's') {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Invalid duration unit in: ${duration}`);
  }
}

/**
 * Collapses one membership row per role into one entry per tenant carrying all
 * its roles — a person who is both OWNER and BOARD_MEMBER should appear once in
 * the switcher, not twice.
 */
function groupRoles<T extends { id: string; role: string }>(
  rows: readonly T[],
): Array<Omit<T, 'role'> & { roles: string[] }> {
  const byId = new Map<string, Omit<T, 'role'> & { roles: string[] }>();

  for (const { role, ...rest } of rows) {
    const existing = byId.get(rest.id as string);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
    } else {
      byId.set(rest.id as string, {
        ...(rest as Omit<T, 'role'>),
        roles: [role],
      });
    }
  }

  return [...byId.values()];
}
