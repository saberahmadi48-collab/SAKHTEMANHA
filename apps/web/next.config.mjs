/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * پکیج‌های ورک‌اسپیس به‌صورت TypeScript خام مصرف می‌شوند تا لازم نباشد پیش از
   * هر `next dev` دستی بیلد شوند. بدون این، تغییر یک متن فارسی در پکیج i18n
   * تا زمان بیلد مجدد در مرورگر دیده نمی‌شود.
   */
  transpilePackages: ['@bops/i18n', '@bops/contracts'],

  /**
   * زبان سند. توجه: `i18n` در App Router پشتیبانی نمی‌شود و اینجا عمداً
   * استفاده نشده؛ زبان و جهت مستقیماً روی تگ <html> در layout ریشه تنظیم
   * می‌شوند که هم ساده‌تر است و هم با رندر سمت سرور سازگارتر.
   */
  experimental: {
    optimizePackageImports: ['@bops/i18n'],
  },
};

export default nextConfig;
