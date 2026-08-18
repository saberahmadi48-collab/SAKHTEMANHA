import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

import type { PersonSummary } from '../../../core/privacy/contact-privacy';

/**
 * Self-service profile shapes — BM-02 §41 (`/api/users/me/profile`).
 *
 * WHAT THIS DTO REFUSES TO ACCEPT IS THE WHOLE DESIGN:
 *
 *  - No `userId` / `personId`. The subject is always the authenticated caller.
 *    A body that could name its own subject turns "edit my profile" into "edit
 *    anyone's profile" the moment a permission check is loosened.
 *  - No `status`. Account suspension is an administrative act with its own
 *    audit action, not a field a user may flip on themselves.
 *  - No role, membership, ownership or building field of any kind. Those are
 *    relationships (BM-02 §58), and a person editing their own profile must not
 *    be able to grant themselves one.
 *
 * `nationalId` IS accepted, but the service refuses to change it once the
 * person has a VERIFIED relationship — see `sensitiveFieldLocked`. BM-02 §41
 * allows self-service for non-sensitive data and requires approval for the
 * rest; identity references sit on the sensitive side of that line.
 */

/** Trims a string and returns undefined for blanks, so optional stays optional. */
const trimmed = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const next = value.trim();
  return next === '' ? undefined : next;
};

/**
 * Normalizes Persian/Arabic-Indic digits to ASCII before validation.
 *
 * Users type ۰۹۱۲… on a Persian keyboard and the raw string will not match a
 * `[0-9]` pattern, so without this a perfectly valid national id or phone
 * number is rejected with a confusing error.
 */
const toLatinDigits = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const next = value
    .replace(/[\u06F0-\u06F9]/g, (d) =>
      String(d.charCodeAt(0) - 0x06f0),
    )
    .replace(/[\u0660-\u0669]/g, (d) =>
      String(d.charCodeAt(0) - 0x0660),
    )
    .trim();
  return next === '' ? undefined : next;
};

/** Updates the caller's own profile. Every field is optional (PATCH semantics). */
export class UpdateMyProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(trimmed)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(trimmed)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Transform(trimmed)
  displayName?: string;

  /**
   * Iranian national id: exactly ten digits.
   *
   * Sensitive (BM-02 §24) — the service locks it once a relationship has been
   * verified against it.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, {
    message: 'کد ملی باید دقیقاً ۱۰ رقم باشد',
  })
  @Transform(toLatinDigits)
  nationalId?: string;

  @IsOptional()
  @IsEmail({}, { message: 'نشانی رایانامه معتبر نیست' })
  @MaxLength(255)
  @Transform(trimmed)
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^0\d{10}$/, {
    message: 'شماره تلفن همراه باید با ۰ شروع شود و ۱۱ رقم باشد',
  })
  @Transform(toLatinDigits)
  phoneNumber?: string;

  /**
   * The person's own consent to be reachable by other building members
   * (BM-00 rule 6). Self-service by design: consent that only an administrator
   * can grant or withdraw is not consent.
   */
  @IsOptional()
  @IsBoolean()
  phoneIsPublic?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trimmed)
  avatarUrl?: string;

  /** BM-02 §48 — the platform stores a preference, never translated labels. */
  @IsOptional()
  @IsIn(['fa-IR', 'en-US'], {
    message: 'زبان انتخابی پشتیبانی نمی‌شود',
  })
  locale?: string;
}

/**
 * The caller's OWN profile — the one place unmasked contact details are
 * returned without PERSON_READ_CONTACT.
 *
 * That is not an exception to BM-00 rule 6: the rule protects a person's data
 * from OTHER people, and this endpoint returns your data to you. Note the
 * absence of `notes` — that field is the manager's internal remarks about a
 * resident and is deliberately never echoed back to the subject.
 */
export interface MyProfileResponse {
  readonly personId: string;
  readonly userId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName: string | null;
  readonly nationalId: string | null;
  readonly email: string | null;
  readonly phoneNumber: string | null;
  readonly phoneIsPublic: boolean;
  readonly avatarUrl: string | null;
  readonly locale: string;
  /**
   * True when a VERIFIED relationship exists against this identity, which locks
   * `nationalId` from self-service edits. Surfaced so the UI can disable the
   * field instead of letting the user discover it via a 409.
   */
  readonly identityLocked: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Another person's profile as seen through a building directory
 * (`/api/buildings/{id}/people/{personId}`).
 *
 * MINIMIZED PER BM-02 §45: this is `PersonSummary` plus the relationships that
 * justify showing the person at all — never the national id, never the notes,
 * never the raw contact unless the caller is entitled to it.
 */
export interface DirectoryPersonResponse {
  readonly person: PersonSummary;
  /** Building-scoped role names, so the UI can label "مالک واحد ۱۲". */
  readonly buildingRoles: readonly string[];
  /** Units this person is attached to IN THIS BUILDING only. */
  readonly unitIds: readonly string[];
}
