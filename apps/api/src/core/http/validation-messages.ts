import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError, ValidationPipeOptions } from '@nestjs/common';
import { ERRORS, FIELDS, VALIDATION } from '@bops/i18n';

/**
 * فارسی‌سازی کامل خروجی `class-validator`.
 *
 * چرا این فایل لازم است: `class-validator` پیام‌های پیش‌فرض انگلیسی تولید
 * می‌کند («name should not be empty»، «email must be an email») و این پیام‌ها
 * مستقیماً زیر فیلدهای فرم نمایش داده می‌شوند. دستور صریحاً «باقی ماندن
 * پیام‌های پیش‌فرض انگلیسی کتابخانه‌ها» را ممنوع کرده است.
 *
 * راهکار انتخاب‌شده: به‌جای نوشتن `{ message: '...' }` روی تک‌تک دکوراتورهای
 * هر DTO — که فراموش‌شدنی است و با افزودن DTO جدید دوباره انگلیسی نشت می‌کند —
 * خروجی را در یک نقطه‌ی مرکزی ترجمه می‌کنیم. هر DTO‌ای که در آینده در BM-02
 * به بعد نوشته شود، به‌صورت خودکار پیام فارسی می‌گیرد.
 *
 * ساختار پاسخ عمداً `{ message, errors: { field: [متن‌ها] } }` است تا کلاینت
 * بتواند خطا را دقیقاً زیر همان فیلد بنشاند، نه فقط در یک Toast کلی.
 */

/**
 * نگاشت نام فیلد انگلیسی (نام پراپرتی DTO) به برچسب فارسی.
 * از `FIELDS` در پکیج i18n می‌خواند تا برچسب فرم و متن خطا هرگز واگرا نشوند.
 */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  // شخص و حساب
  firstName: FIELDS.firstName,
  lastName: FIELDS.lastName,
  fullName: FIELDS.fullName,
  nationalId: FIELDS.nationalId,
  email: FIELDS.email,
  phone: FIELDS.phone,
  phoneNumber: FIELDS.phone,
  password: FIELDS.password,
  passwordConfirm: FIELDS.passwordConfirm,

  // ساختمان و واحد
  name: FIELDS.name,
  title: FIELDS.title,
  description: FIELDS.description,
  buildingId: FIELDS.building,
  buildingName: FIELDS.buildingName,
  organizationId: FIELDS.organization,
  unitId: FIELDS.unit,
  unitNumber: FIELDS.unitNumber,
  kind: FIELDS.unitKind,
  floor: FIELDS.floor,
  block: FIELDS.block,
  areaSquareMeters: FIELDS.areaSquareMeters,
  bedrooms: FIELDS.bedrooms,
  parkingCount: FIELDS.parkingCount,
  storageCount: FIELDS.storageCount,
  shareRatio: FIELDS.shareRatio,
  totalUnits: FIELDS.totalUnits,
  floors: FIELDS.floors,
  buildYear: FIELDS.buildYear,

  // نشانی
  province: FIELDS.province,
  city: FIELDS.city,
  district: FIELDS.district,
  street: FIELDS.street,
  postalCode: FIELDS.postalCode,
  plaque: FIELDS.plaque,
  latitude: FIELDS.latitude,
  longitude: FIELDS.longitude,

  // زمان و دوره
  periodStart: FIELDS.periodStart,
  periodEnd: FIELDS.periodEnd,
  startsAt: FIELDS.termStart,
  endsAt: FIELDS.termEnd,
  expiresAt: FIELDS.expiresAt,
  dueDate: FIELDS.dueDate,

  // نقش و مالی
  role: FIELDS.role,
  status: FIELDS.status,
  amount: FIELDS.amount,
  currency: FIELDS.currency,
  notes: FIELDS.notes,
};

/** برچسب فارسی یک فیلد؛ اگر نگاشت نشده باشد، خود نام برگردانده می‌شود. */
function fieldLabel(property: string): string {
  return FIELD_LABELS[property] ?? property;
}

/**
 * ترجمه‌ی یک محدودیت `class-validator` به پیام فارسی.
 *
 * کلیدهای `constraints` نام قاعده هستند (`isNotEmpty`، `isEmail`، …) و مقدار
 * آن‌ها پیام انگلیسی. ما فقط از کلید استفاده می‌کنیم و مقدار انگلیسی را کاملاً
 * دور می‌ریزیم — همین تضمین می‌کند هیچ متن انگلیسی‌ای به UI نرسد.
 */
function translateConstraint(
  constraintKey: string,
  property: string,
  englishMessage: string,
): string {
  const label = fieldLabel(property);

  switch (constraintKey) {
    case 'isNotEmpty':
    case 'isDefined':
      return VALIDATION.required(label);

    case 'isEmail':
      return VALIDATION.invalidEmail;

    case 'isMobilePhone':
    case 'isPhoneNumber':
      return VALIDATION.invalidPhone;

    // قواعد اختصاصی ایران — تعریف‌شده در common/validators/iranian.validators.ts
    case 'isNationalId':
      return VALIDATION.invalidNationalId;

    case 'isPostalCode':
      return VALIDATION.invalid(FIELDS.postalCode);

    case 'isStrongPassword':
      return VALIDATION.passwordTooWeak;

    case 'atLeastOneOf':
      return ERRORS.emailOrPhoneRequired;

    case 'isUuid':
      return VALIDATION.invalid(`شناسه ${label}`);

    case 'isDate':
    case 'isDateString':
      return VALIDATION.invalidDate;

    case 'isNumber':
    case 'isInt':
    case 'isNumberString':
      return VALIDATION.notANumber(label);

    case 'isPositive':
      return VALIDATION.amountMustBePositive;

    case 'minLength':
      return VALIDATION.tooShort(label, extractNumber(englishMessage) ?? 0);

    case 'maxLength':
      return VALIDATION.tooLong(label, extractNumber(englishMessage) ?? 0);

    case 'min':
    case 'max':
      return VALIDATION.invalid(label);

    case 'isEnum':
    case 'isIn':
      return VALIDATION.invalid(label);

    case 'isString':
    case 'isBoolean':
    case 'isArray':
      return VALIDATION.invalid(label);

    case 'whitelistValidation':
      // فیلد ناشناخته در بدنه‌ی درخواست. این یک کنترل چندمستأجری است
      // (BM-00 قاعده ۸)، نه فقط نظافت ورودی — کلاینت نباید بتواند
      // `buildingId` را قاچاقی وارد بدنه کند.
      return VALIDATION.unexpectedField(property);

    default:
      return VALIDATION.invalid(label);
  }
}

/** استخراج نخستین عدد از پیام انگلیسی (برای minLength/maxLength). */
function extractNumber(message: string): number | null {
  const match = /\d+/.exec(message);
  return match ? Number(match[0]) : null;
}

/** ساختار خطای بازگشتی به کلاینت: نگاشت نام فیلد به فهرست پیام‌های فارسی. */
export type FieldErrorMap = Record<string, string[]>;

/**
 * تخت‌کردن درخت `ValidationError` به نگاشت فیلد→پیام‌ها.
 * از بازگشت (recursion) استفاده می‌کند چون DTOهای تودرتو (مثل `address` در
 * ساختمان) خطاهای فرزند تولید می‌کنند و باید با مسیر کامل («address.city»)
 * به کلاینت برسند تا فرم بداند کدام ورودی را قرمز کند.
 */
export function flattenValidationErrors(
  errors: readonly ValidationError[],
  parentPath = '',
): FieldErrorMap {
  const result: FieldErrorMap = {};

  for (const error of errors) {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;

    if (error.constraints) {
      const messages = Object.entries(error.constraints).map(([key, value]) =>
        translateConstraint(key, error.property, value),
      );
      // حذف پیام‌های تکراری: چند قاعده ممکن است به یک متن فارسی ترجمه شوند
      // (مثلاً isString و isEnum هر دو «معتبر نیست») و نمایش دوباره‌ی یک جمله
      // زیر فیلد، بی‌دقت به نظر می‌رسد.
      result[path] = [...new Set(messages)];
    }

    if (error.children && error.children.length > 0) {
      Object.assign(result, flattenValidationErrors(error.children, path));
    }
  }

  return result;
}

/**
 * تنظیمات `ValidationPipe` با خروجی کاملاً فارسی.
 *
 * `whitelist` و `forbidNonWhitelisted` عمداً روشن می‌مانند: این‌ها کنترل
 * ایزولاسیون مستأجر هستند و صرفاً بهداشت ورودی نیستند.
 */
export const persianValidationPipeOptions: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
  exceptionFactory: (errors: ValidationError[]) => {
    const fieldErrors = flattenValidationErrors(errors);
    return new BadRequestException({
      statusCode: 400,
      message: ERRORS.validationFailed,
      errors: fieldErrors,
    });
  },
};

/** نمونه‌ی آماده‌ی pipe برای استفاده در `main.ts`. */
export function createPersianValidationPipe(): ValidationPipe {
  return new ValidationPipe(persianValidationPipeOptions);
}
