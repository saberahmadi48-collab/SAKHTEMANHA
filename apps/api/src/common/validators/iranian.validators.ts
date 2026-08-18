import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { toLatinDigits } from '@bops/i18n';

/**
 * Iran-specific field validators used by every DTO that accepts a phone number
 * or a national id (BM-01 §9, §21).
 *
 * WHY CUSTOM RATHER THAN class-validator's BUILT-INS:
 *   - `@IsMobilePhone('fa-IR')` rejects the Persian digits Iranian users
 *     actually type ("۰۹۱۲…"), so every real form submission would 400.
 *   - There is no national-id validator at all; the code carries a checksum,
 *     and accepting an invalid one means a resident record that can never be
 *     matched against an official document later.
 *
 * All of these NORMALISE Persian/Arabic digits before testing, matching the
 * front end's `toLatinDigits` on input. Validation and storage therefore agree
 * on what the value is.
 */

/** Iranian mobile: 09xxxxxxxxx, also accepting +989… and 00989… prefixes. */
const MOBILE_PATTERN = /^(?:\+98|0098|98|0)?9\d{9}$/;

/**
 * Normalises a phone number to the canonical `09xxxxxxxxx` form used for
 * storage and uniqueness. Returns null when the input is not a valid Iranian
 * mobile number — callers must treat that as a validation failure, never as
 * "store it as typed".
 */
export function normalizeIranianMobile(value: string): string | null {
  const digits = toLatinDigits(String(value)).replace(/[\s-]/g, '');
  if (!MOBILE_PATTERN.test(digits)) return null;
  // Keep the last 10 digits (9xxxxxxxxx) and prefix a single zero, collapsing
  // every accepted international form onto one stored representation.
  return `0${digits.slice(-10)}`;
}

/**
 * Validates the Iranian national id (کد ملی) including its check digit.
 *
 * The checksum matters: without it "1111111111" and any 10 random digits pass,
 * and BM-01 §21 makes this the key used to recognise the same human across
 * buildings. A typo that validates is a duplicate person record forever.
 */
export function isValidIranianNationalId(value: string): boolean {
  const code = toLatinDigits(String(value)).replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(code)) return false;

  // Repdigits (0000000000, 1111111111 …) satisfy the checksum arithmetic but
  // are not issued, so they are rejected explicitly.
  if (/^(\d)\1{9}$/.test(code)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(code[i]) * (10 - i);
  }
  const remainder = sum % 11;
  const checkDigit = Number(code[9]);
  return remainder < 2 ? checkDigit === remainder : checkDigit === 11 - remainder;
}

/**
 * Iranian postal code: 10 digits, and neither the first digit nor the fifth may
 * be 0 or 2 per Iran Post's own rule.
 */
export function isValidIranianPostalCode(value: string): boolean {
  const code = toLatinDigits(String(value)).replace(/[\s-]/g, '');
  return /^(?!(\d)\1{9})[13-9]{4}[1346-9][013-9]{5}$/.test(code);
}

/**
 * Password strength gate: at least 8 characters, containing a letter and a
 * digit. Kept here rather than as a regex on the DTO so the rule has ONE
 * definition and the Persian message in VALIDATION.passwordTooWeak cannot
 * drift from what is actually enforced.
 *
 * GOTCHA THIS FIXES: the digit test counts Persian/Arabic-Indic digits too.
 * A user typing "گذرواژه۱۲۳" on a Persian keyboard satisfies the rule the
 * Persian message states, but a plain `\d` would reject it and show an error
 * that contradicts its own wording. The password itself is NEVER normalised —
 * only this test looks past the digit shape — because rewriting the characters
 * would mean a password typed one way could not be re-entered the other.
 */
const LETTER_PATTERN = /[A-Za-z\u0600-\u06FF]/;
const ANY_DIGIT_PATTERN = /[0-9\u06F0-\u06F9\u0660-\u0669]/;

export function isStrongEnoughPassword(value: string): boolean {
  if (typeof value !== 'string' || value.length < 8) return false;
  return LETTER_PATTERN.test(value) && ANY_DIGIT_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
//  class-validator decorators
//
//  Each returns the constraint KEY that validation-messages.ts translates, so
//  no English default text can reach the UI. Adding a decorator here without a
//  matching case in translateConstraint falls back to "«فیلد» معتبر نیست",
//  which is still Persian — the failure mode is vague, never English.
// ---------------------------------------------------------------------------

export function IsIranianMobile(options?: ValidationOptions) {
  return function decorate(target: object, propertyName: string): void {
    registerDecorator({
      name: 'isMobilePhone',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' && normalizeIranianMobile(value) !== null
          );
        },
        defaultMessage(): string {
          return 'isMobilePhone';
        },
      },
    });
  };
}

export function IsIranianNationalId(options?: ValidationOptions) {
  return function decorate(target: object, propertyName: string): void {
    registerDecorator({
      name: 'isNationalId',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isValidIranianNationalId(value);
        },
        defaultMessage(): string {
          return 'isNationalId';
        },
      },
    });
  };
}

export function IsIranianPostalCode(options?: ValidationOptions) {
  return function decorate(target: object, propertyName: string): void {
    registerDecorator({
      name: 'isPostalCode',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isValidIranianPostalCode(value);
        },
        defaultMessage(): string {
          return 'isPostalCode';
        },
      },
    });
  };
}

export function IsStrongPassword(options?: ValidationOptions) {
  return function decorate(target: object, propertyName: string): void {
    registerDecorator({
      name: 'isStrongPassword',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isStrongEnoughPassword(value);
        },
        defaultMessage(): string {
          return 'isStrongPassword';
        },
      },
    });
  };
}

/**
 * Cross-field rule: at least one of the listed sibling properties must be set.
 * Used by RegisterDto (email OR phone) and CreateInvitationDto, where requiring
 * both would block legitimate onboarding of a resident who has only a phone.
 */
export function AtLeastOneOf(
  properties: readonly string[],
  options?: ValidationOptions,
) {
  return function decorate(target: object, propertyName: string): void {
    registerDecorator({
      name: 'atLeastOneOf',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const object = args.object as Record<string, unknown>;
          return properties.some((property) => {
            const candidate = object[property];
            return (
              candidate !== undefined &&
              candidate !== null &&
              String(candidate).trim() !== ''
            );
          });
        },
        defaultMessage(): string {
          return 'atLeastOneOf';
        },
      },
    });
  };
}
