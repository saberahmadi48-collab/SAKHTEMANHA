import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

import {
  AtLeastOneOf,
  IsIranianMobile,
  IsIranianNationalId,
  IsStrongPassword,
  normalizeIranianMobile,
} from '../../../common/validators/iranian.validators';

/**
 * Request/response shapes for the authentication endpoints (BM-01 §32 step 1).
 *
 * Two rules govern everything in this file:
 *
 *  1. NO SCOPE FIELDS. A registration or login body never carries
 *     `organizationId`, `buildingId` or `role`. BM-00 rule 8 forbids trusting
 *     client-supplied tenancy, and `forbidNonWhitelisted` in the global pipe
 *     turns any attempt to smuggle one into a 400 rather than a silent
 *     privilege grant.
 *
 *  2. Input is NORMALISED at the edge. Phone numbers arrive in half a dozen
 *     shapes (Persian digits, +98, spaces) and email in mixed case; both are
 *     canonicalised here so uniqueness is decided on one representation and a
 *     user cannot accidentally register twice.
 */

/** Trims a string and returns undefined for blanks, so optional stays optional. */
const trimmed = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const next = value.trim();
  return next === '' ? undefined : next;
};

export class RegisterDto {
  /**
   * Either email or phone is required, never both — see AtLeastOneOf. Lowercased
   * on the way in; the column is citext as well, so uniqueness holds even if a
   * future caller bypasses this transform.
   */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || undefined : value,
  )
  @IsEmail()
  @MaxLength(255)
  @AtLeastOneOf(['email', 'phoneNumber'])
  email?: string;

  /**
   * Normalised to `09xxxxxxxxx` here so uniqueness is decided on one form.
   * An unnormalisable value is passed through UNCHANGED rather than dropped —
   * @IsIranianMobile then rejects it with the Persian message. Silently
   * blanking it would turn "bad phone number" into the misleading "at least one
   * of email or phone is required".
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmedValue = value.trim();
    if (trimmedValue === '') return undefined;
    return normalizeIranianMobile(trimmedValue) ?? trimmedValue;
  })
  @IsIranianMobile()
  phoneNumber?: string;

  @IsString()
  @IsStrongPassword()
  @MaxLength(128)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(trimmed)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(trimmed)
  lastName!: string;

  /** Optional at signup: BM-01 §9 forbids demanding every detail at onboarding. */
  @IsOptional()
  @Transform(trimmed)
  @IsIranianNationalId()
  nationalId?: string;
}

export class LoginDto {
  /**
   * One field for both identifiers on purpose. A separate email/phone toggle in
   * the UI is friction, and the server can tell them apart unambiguously.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Transform(trimmed)
  identifier!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  @MaxLength(512)
  refreshToken!: string;
}

export class LogoutDto {
  /**
   * Optional: omitting it ends only the current session. Sending the token lets
   * a client revoke a specific device from a session list.
   */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  refreshToken?: string;
}

/** Token pair returned by register/login/refresh. */
export interface AuthTokensResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Access-token lifetime in seconds, so the client can schedule a refresh. */
  readonly expiresIn: number;
}

/**
 * The authenticated user's own profile. Note what is ABSENT: no password hash,
 * no MFA secret, no token generation. This shape is what `/auth/me` returns and
 * it is assembled field by field rather than spread from the entity, so a new
 * sensitive column added to User later cannot leak by default.
 */
export interface CurrentUserResponse {
  readonly userId: string;
  readonly personId: string | null;
  readonly email: string | null;
  readonly phoneNumber: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly status: string;
  readonly emailVerified: boolean;
  readonly phoneVerified: boolean;
  /** Organizations and buildings the caller can actually reach, for the switcher. */
  readonly organizations: readonly {
    readonly id: string;
    readonly name: string;
    readonly roles: readonly string[];
  }[];
  readonly buildings: readonly {
    readonly id: string;
    readonly name: string;
    readonly organizationId: string;
    readonly roles: readonly string[];
  }[];
}
