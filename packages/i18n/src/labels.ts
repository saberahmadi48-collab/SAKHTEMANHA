/**
 * توابع برچسب‌گذاری — تبدیل مقادیر enum به متن فارسی.
 *
 * چرا تابع به‌جای دسترسی مستقیم به شیء برچسب‌ها:
 *   ۱. اگر مقدار ناشناخته‌ای از سرور بیاید (نسخه‌ی جدیدتر API)، به‌جای نمایش
 *      رشته‌ی خام انگلیسی در UI، متن امن فارسی برمی‌گردانیم. این دقیقاً همان
 *      «باقی ماندن متن انگلیسی» است که ممنوع اعلام شده.
 *   ۲. امضای تابع مقدار را به enum محدود می‌کند، پس افزودن نقش جدید در Prisma
 *      بدون افزودن برچسب فارسی، خطای کامپایل می‌دهد نه باگ زمان اجرا.
 */

import {
  BUILDING_ROLE_LABELS,
  CHARGE_CYCLE_LABELS,
  COMMON,
  LOCATION_PRECISION_LABELS,
  OCCUPANCY_KIND_LABELS,
  ORGANIZATION_ROLE_LABELS,
  ORGANIZATION_TYPE_LABELS,
  STATUS_LABELS,
  UNIT_KIND_LABELS,
} from './messages';

export type BuildingRoleKey = keyof typeof BUILDING_ROLE_LABELS;
export type OrganizationRoleKey = keyof typeof ORGANIZATION_ROLE_LABELS;
export type StatusKey = keyof typeof STATUS_LABELS;
export type UnitKindKey = keyof typeof UNIT_KIND_LABELS;
export type OrganizationTypeKey = keyof typeof ORGANIZATION_TYPE_LABELS;
export type OccupancyKindKey = keyof typeof OCCUPANCY_KIND_LABELS;
export type ChargeCycleKey = keyof typeof CHARGE_CYCLE_LABELS;
export type LocationPrecisionKey = keyof typeof LOCATION_PRECISION_LABELS;

/**
 * برچسب فارسی نقش ساختمانی.
 * ورودی `string` هم پذیرفته می‌شود چون پاسخ API در زمان اجرا تایپ ندارد؛
 * مقدار ناشناخته به «نامشخص» تبدیل می‌شود، نه اینکه خام نمایش داده شود.
 */
export function buildingRoleLabel(role: string): string {
  return BUILDING_ROLE_LABELS[role as BuildingRoleKey] ?? COMMON.unknown;
}

/** برچسب فارسی نقش سازمانی. */
export function organizationRoleLabel(role: string): string {
  return (
    ORGANIZATION_ROLE_LABELS[role as OrganizationRoleKey] ?? COMMON.unknown
  );
}

/** برچسب فارسی وضعیت. */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status as StatusKey] ?? COMMON.unknown;
}

/** برچسب فارسی نوع کاربری واحد. */
export function unitKindLabel(kind: string): string {
  return UNIT_KIND_LABELS[kind as UnitKindKey] ?? COMMON.unknown;
}

/** برچسب فارسی نوع سازمان (BM-01 §4). */
export function organizationTypeLabel(type: string): string {
  return ORGANIZATION_TYPE_LABELS[type as OrganizationTypeKey] ?? COMMON.unknown;
}

/** برچسب فارسی نوع سکونت (BM-01 §20). */
export function occupancyKindLabel(kind: string): string {
  return OCCUPANCY_KIND_LABELS[kind as OccupancyKindKey] ?? COMMON.unknown;
}

/** برچسب فارسی دوره‌ی صدور شارژ (BM-01 §27). */
export function chargeCycleLabel(cycle: string): string {
  return CHARGE_CYCLE_LABELS[cycle as ChargeCycleKey] ?? COMMON.unknown;
}

/** برچسب فارسی سطح دقت موقعیت مکانی (BM-01 §11). */
export function locationPrecisionLabel(precision: string): string {
  return (
    LOCATION_PRECISION_LABELS[precision as LocationPrecisionKey] ??
    COMMON.unknown
  );
}

/**
 * رنگ نشان وضعیت (variant) برای کامپوننت Badge.
 * جدا از برچسب نگه داشته شده تا منطق نمایش با متن قاطی نشود.
 */
export type StatusVariant = 'success' | 'warning' | 'danger' | 'neutral';

export function statusVariant(status: string): StatusVariant {
  switch (status) {
    case 'ACTIVE':
    case 'ACCEPTED':
    case 'COMPLETED':
      return 'success';
    case 'PENDING':
    case 'PENDING_VERIFICATION':
    case 'SCHEDULED':
    case 'DRAFT':
    case 'IN_PROGRESS':
    case 'UNDER_CONSTRUCTION':
    case 'UNDER_RENOVATION':
    case 'UNMANAGED':
      return 'warning';
    case 'SUSPENDED':
    case 'CANCELLED':
    case 'TERMINATED':
    case 'REVOKED':
    case 'EXPIRED':
    case 'DISPUTED':
    case 'DEACTIVATED':
    case 'DECOMMISSIONED':
      return 'danger';
    default:
      return 'neutral';
  }
}

/**
 * نام کامل شخص با در نظر گرفتن نبود داده.
 * هرگز رشته‌ی خالی برنمی‌گرداند — یک سلول خالی در جدول، کاربر را سردرگم
 * می‌کند در حالی که «ثبت نشده» وضعیت را روشن می‌گوید.
 */
export function fullNameLabel(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  const parts = [firstName, lastName].filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  return parts.length > 0 ? parts.join(' ') : COMMON.notSpecified;
}
