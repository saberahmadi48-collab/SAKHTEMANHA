/**
 * سطح عمومی پکیج i18n.
 *
 * هم API (برای پیام‌های خطا) و هم کلاینت Next.js (برای کل رابط کاربری) از
 * اینجا می‌خوانند، پس این پکیج نباید هیچ وابستگی زمان‌اجرا داشته باشد —
 * نه Prisma، نه Nest، نه React.
 */
export * from './messages';
export * from './format';
export * from './labels';
