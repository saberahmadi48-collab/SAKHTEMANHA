/**
 * قالب‌بندی فارسی: تاریخ شمسی، مبلغ، ارقام و بازه‌های زمانی.
 *
 * تصمیم معماری: هیچ کتابخانه‌ی تاریخ شمسی (jalaali-js، dayjs-jalali، moment-jalaali)
 * اضافه نشده است. `Intl` با تقویم `persian` روی Node 20+ و همه‌ی مرورگرهای
 * هدف، تاریخ شمسی و ارقام فارسی را درست تولید می‌کند — این را با اجرای واقعی
 * سنجیدم و «۱ فروردین ۱۴۰۳» برگرداند. یک وابستگی کمتر یعنی یک سطح آسیب‌پذیری
 * و یک منبع اختلاف کمتر در محاسبات مالی.
 *
 * قاعده‌ی حیاتی برای BM-03 به بعد: تاریخ‌ها همیشه به‌صورت UTC ذخیره می‌شوند و
 * فقط در لحظه‌ی نمایش به شمسی تبدیل می‌گردند. هرگز تاریخ شمسیِ قالب‌بندی‌شده را
 * در پایگاه داده ننویسید — دوره‌های مالی باید قابل مقایسه و مرتب‌سازی بمانند.
 */

import { toPersianDigits } from './messages';

/** منطقه‌ی زمانی پیش‌فرض. با فیلد `timezone` در مدل Building هم‌راستاست. */
export const DEFAULT_TIME_ZONE = 'Asia/Tehran';

/** شناسه‌ی زبان با تقویم شمسی. */
export const PERSIAN_LOCALE = 'fa-IR-u-ca-persian';

/** شناسه‌ی زبان بدون تقویم — برای اعداد و مبالغ. */
export const PERSIAN_NUMBER_LOCALE = 'fa-IR';

/** نام ماه‌های شمسی — برای انتخابگر دوره در صفحات مالی. */
export const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const;

/** نام روزهای هفته، از شنبه. */
export const JALALI_WEEKDAYS = [
  'شنبه',
  'یک‌شنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنج‌شنبه',
  'جمعه',
] as const;

/**
 * ساخت `Intl.DateTimeFormat` با کش.
 * ساخت هر نمونه‌ی Intl گران است و در جدولی با ۵۰۰ ردیف تاریخ، بدون کش به
 * افت محسوس رندر منجر می‌شود.
 */
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getDateFormatter(
  options: Intl.DateTimeFormatOptions,
  timeZone: string,
): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let formatter = dateFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(PERSIAN_LOCALE, {
      ...options,
      timeZone,
    });
    dateFormatterCache.set(key, formatter);
  }
  return formatter;
}

/** ورودی‌های پذیرفته‌شده برای تاریخ. `null`/`undefined` هم مجاز است تا صفحات
 *  مجبور نشوند برای فیلدهای اختیاری شرط بنویسند. */
export type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * تاریخ شمسی کوتاه: «۱۴۰۳/۰۱/۰۱».
 * مناسب ستون‌های جدول که فضا محدود است.
 */
export function formatJalaliDate(
  value: DateInput,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const date = toDate(value);
  if (!date) return '—';
  return getDateFormatter(
    { year: 'numeric', month: '2-digit', day: '2-digit' },
    timeZone,
  ).format(date);
}

/**
 * تاریخ شمسی بلند: «۱ فروردین ۱۴۰۳».
 * مناسب صفحات جزئیات و سرصفحه‌ها.
 */
export function formatJalaliDateLong(
  value: DateInput,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const date = toDate(value);
  if (!date) return '—';
  return getDateFormatter(
    { year: 'numeric', month: 'long', day: 'numeric' },
    timeZone,
  ).format(date);
}

/** تاریخ و ساعت شمسی: «۱ فروردین ۱۴۰۳، ۱۴:۳۰». */
export function formatJalaliDateTime(
  value: DateInput,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const date = toDate(value);
  if (!date) return '—';
  return getDateFormatter(
    { dateStyle: 'medium', timeStyle: 'short' },
    timeZone,
  ).format(date);
}

/** فقط ساعت: «۱۴:۳۰». */
export function formatJalaliTime(
  value: DateInput,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const date = toDate(value);
  if (!date) return '—';
  return getDateFormatter(
    { hour: '2-digit', minute: '2-digit' },
    timeZone,
  ).format(date);
}

/**
 * زمان نسبی: «۳ روز پیش»، «۲ ماه بعد».
 * برای ستون «آخرین به‌روزرسانی» و فهرست اعلان‌ها.
 */
const relativeFormatter = new Intl.RelativeTimeFormat(PERSIAN_NUMBER_LOCALE, {
  numeric: 'auto',
});

export function formatRelativeTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return '—';

  const diffSeconds = (date.getTime() - Date.now()) / 1000;
  const absolute = Math.abs(diffSeconds);

  const thresholds: ReadonlyArray<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [604800, 'day'],
    [2592000, 'week'],
    [31536000, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];
  const divisors: Record<string, number> = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86400,
    week: 604800,
    month: 2592000,
    year: 31536000,
  };

  for (const [limit, unit] of thresholds) {
    if (absolute < limit) {
      const divisor = divisors[unit] ?? 1;
      return relativeFormatter.format(Math.round(diffSeconds / divisor), unit);
    }
  }
  return formatJalaliDate(date);
}

/**
 * بازه‌ی تاریخ: «از ۱ فروردین ۱۴۰۳ تا ۱ مهر ۱۴۰۳».
 * بازه‌ی باز (بدون پایان) «تاکنون» نمایش داده می‌شود — این حالت در مدل‌های
 * `UnitOwnership`، `UnitOccupancy` و `ManagementTerm` یعنی رکورد هنوز جاری است.
 */
export function formatJalaliDateRange(
  start: DateInput,
  end: DateInput,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const startText = formatJalaliDateLong(start, timeZone);
  if (!toDate(end)) return `از ${startText} تاکنون`;
  return `از ${startText} تا ${formatJalaliDateLong(end, timeZone)}`;
}

/** عدد با جداکننده‌ی هزارگان و ارقام فارسی: «۱٬۲۳۴٬۵۶۷». */
const numberFormatter = new Intl.NumberFormat(PERSIAN_NUMBER_LOCALE);

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return numberFormatter.format(value);
}

/**
 * مبلغ با واحد پول: «۱٬۲۵۰٬۰۰۰ ریال».
 *
 * چرا `Intl.NumberFormat` با `style: 'currency'` استفاده نشده: خروجی آن
 * «‎ریال ۱۲٬۵۰۰٬۰۰۰» است و واحد پول را در سمت اشتباه قرار می‌دهد. متن فارسی
 * درست، مبلغ را پیش از واحد می‌آورد، پس عدد را جدا قالب‌بندی می‌کنیم.
 *
 * ورودی `string` هم پذیرفته می‌شود چون Prisma مقادیر `Decimal` را برای حفظ
 * دقت به‌صورت رشته برمی‌گرداند — تبدیل آن به `number` در مبالغ بزرگ ریالی
 * خطای ممیز شناور ایجاد می‌کند و این در سامانه‌ی مالی پذیرفتنی نیست.
 */
export function formatCurrency(
  value: number | string | null | undefined,
  currency: 'IRR' | 'TOMAN' = 'IRR',
): string {
  if (value === null || value === undefined || value === '') return '—';

  const numeric = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(numeric)) return '—';

  const label = currency === 'TOMAN' ? 'تومان' : 'ریال';
  return `${numberFormatter.format(numeric)} ${label}`;
}

/** درصد: «۱۲٫۵٪». */
export function formatPercent(
  value: number | null | undefined,
  fractionDigits = 1,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${new Intl.NumberFormat(PERSIAN_NUMBER_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(value)}٪`;
}

/** متراژ: «۹۵ متر مربع». */
export function formatArea(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${numberFormatter.format(value)} متر مربع`;
}

/**
 * شماره تلفن با ارقام فارسی و گروه‌بندی: «۰۹۱۲ ۱۲۳ ۴۵۶۷».
 * ورودی ممکن است ارقام فارسی داشته باشد، پس اول به لاتین نرمال می‌شود.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11) return toPersianDigits(value);
  return toPersianDigits(
    `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`,
  );
}

/**
 * استخراج اجزای تاریخ شمسی به‌صورت عددی.
 * برای انتخابگر دوره در BM-03 لازم است، جایی که باید بدانیم «شارژ مهر ۱۴۰۳»
 * به کدام بازه‌ی UTC نگاشت می‌شود.
 */
export function getJalaliParts(
  value: DateInput,
  timeZone: string = DEFAULT_TIME_ZONE,
): { year: number; month: number; day: number } | null {
  const date = toDate(value);
  if (!date) return null;

  const parts = getDateFormatter(
    { year: 'numeric', month: 'numeric', day: 'numeric' },
    timeZone,
  ).formatToParts(date);

  // formatToParts ارقام را با locale فارسی برمی‌گرداند، پس پیش از Number()
  // باید به لاتین تبدیل شوند.
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const raw = parts.find((part) => part.type === type)?.value ?? '0';
    return Number(
      raw
        .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
        .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)),
    );
  };

  return { year: read('year'), month: read('month'), day: read('day') };
}

/** نام ماه شمسی یک تاریخ: «مهر». */
export function getJalaliMonthName(
  value: DateInput,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const parts = getJalaliParts(value, timeZone);
  if (!parts) return '—';
  return JALALI_MONTHS[parts.month - 1] ?? '—';
}

/** برچسب دوره‌ی مالی: «مهر ۱۴۰۳». */
export function formatJalaliPeriod(
  value: DateInput,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const parts = getJalaliParts(value, timeZone);
  if (!parts) return '—';
  const month = JALALI_MONTHS[parts.month - 1] ?? '';
  return `${month} ${toPersianDigits(parts.year)}`;
}
