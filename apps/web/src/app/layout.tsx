import type { Metadata, Viewport } from 'next';
import { NAV } from '@bops/i18n';

import { vazirmatn } from '@/lib/fonts';

import './globals.css';

/**
 * layout ریشه — نقطه‌ای که فارسی و راست‌چین بودن کل برنامه تعیین می‌شود.
 *
 * `lang="fa"` و `dir="rtl"` عمداً اینجا و روی تگ <html> نشسته‌اند، نه روی یک
 * <div> داخلی. دلیلش این است که پرتال‌ها (مودال، منوی کشویی، Toast) خارج از
 * درخت اصلی و مستقیماً زیر <body> رندر می‌شوند؛ اگر جهت را روی یک عنصر
 * داخلی بگذاریم، آن پرتال‌ها چپ‌چین می‌مانند و دقیقاً همان «LTR بودن لایه‌های
 * اصلی صفحه» رخ می‌دهد که ممنوع اعلام شده.
 *
 * `lang="fa"` صرفاً تشریفاتی نیست: انتخاب فونت، تقسیم کلمات، غلط‌یاب مرورگر و
 * تلفظ صفحه‌خوان همگی به آن وابسته‌اند.
 */

/**
 * فونت وزیرمتن از `@/lib/fonts` می‌آید و از فایل‌های محلی مخزن بارگذاری
 * می‌شود — هیچ درخواستی به گوگل‌فونت یا CDN خارجی وجود ندارد. جزئیات و
 * دلیل این تصمیم در همان فایل توضیح داده شده است.
 */

export const metadata: Metadata = {
  title: {
    default: 'سامانه مدیریت ساختمان',
    template: '%s | سامانه مدیریت ساختمان',
  },
  description:
    'سامانه یکپارچه مدیریت ساختمان: شارژ، امور مالی، نگهداری و تعمیرات، هیئت مدیره و ارتباطات ساکنان',
  applicationName: 'سامانه مدیریت ساختمان',
  // جهت‌گیری زبان برای موتورهای جست‌وجو و اشتراک‌گذاری.
  openGraph: {
    locale: 'fa_IR',
    type: 'website',
    siteName: 'سامانه مدیریت ساختمان',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1d4ed8',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <html lang="fa" dir="rtl" className={vazirmatn.variable}>
      <body>
        {/* دسترس‌پذیری: پرش مستقیم به محتوا برای کاربران صفحه‌کلید و
            صفحه‌خوان، بدون عبور از کل منوی کناری. */}
        <a href="#main-content" className="skip-link">
          {NAV.skipToContent}
        </a>
        {children}
      </body>
    </html>
  );
}
