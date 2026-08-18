import type { Config } from 'tailwindcss';

/**
 * پیکربندی Tailwind برای رابط راست‌چین فارسی.
 *
 * نکته‌ی کلیدی RTL: در کل پروژه باید از ابزارهای «منطقی» (logical) استفاده
 * شود نه جهت‌دار فیزیکی:
 *   ✅  ms-4  me-4  ps-4  pe-4  start-0  end-0  text-start  text-end
 *   ❌  ml-4  mr-4  pl-4  pr-4  left-0   right-0 text-left  text-right
 *
 * ابزارهای منطقی خودشان با `dir="rtl"` معکوس می‌شوند، پس نیازی به پلاگین
 * `tailwindcss-rtl` یا نوشتن واریانت دستی نیست. اگر جایی از `ml-*` استفاده
 * شود، در چیدمان راست‌چین به‌اشتباه در سمت غلط می‌نشیند — اسکریپت
 * `npm run i18n:lint` دقیقاً همین را پیدا می‌کند.
 */
const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/features/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // متغیر توسط next/font در layout ریشه تزریق می‌شود.
        sans: ['var(--font-vazirmatn)', 'Tahoma', 'Arial', 'sans-serif'],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        'card-foreground': 'hsl(var(--card-foreground))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        primary: 'hsl(var(--primary))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        success: 'hsl(var(--success))',
        'success-foreground': 'hsl(var(--success-foreground))',
        warning: 'hsl(var(--warning))',
        'warning-foreground': 'hsl(var(--warning-foreground))',
        danger: 'hsl(var(--danger))',
        'danger-foreground': 'hsl(var(--danger-foreground))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontSize: {
        // خط فارسی در اندازه‌ی یکسان کوتاه‌تر از لاتین دیده می‌شود و ارتفاع
        // خط بیشتری لازم دارد تا نقطه‌ها و کشیدگی‌ها روی هم نیفتند.
        xs: ['0.75rem', { lineHeight: '1.6' }],
        sm: ['0.875rem', { lineHeight: '1.7' }],
        base: ['1rem', { lineHeight: '1.8' }],
        lg: ['1.125rem', { lineHeight: '1.8' }],
        xl: ['1.25rem', { lineHeight: '1.7' }],
        '2xl': ['1.5rem', { lineHeight: '1.6' }],
      },
    },
  },
  plugins: [],
};

export default config;
