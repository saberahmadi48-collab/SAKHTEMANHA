import * as React from 'react';
import { COMMON } from '@bops/i18n';

import { cn } from '@/lib/cn';

/**
 * دکمه‌ی پایه.
 *
 * دو نکته‌ی مهم برای رابط فارسی:
 *   ۱. حالت `isLoading` متن فارسی «در حال بارگذاری…» را جایگزین محتوا می‌کند،
 *      نه یک اسپینر بی‌متن. صفحه‌خوان باید بداند چه اتفاقی می‌افتد.
 *   ۲. هیچ متن پیش‌فرض انگلیسی وجود ندارد — حتی `aria-label` هم از فرهنگ
 *      متن‌های فارسی خوانده می‌شود.
 *
 * از کلاس‌های منطقی (`ms-*`, `pe-*`) استفاده شده تا در چیدمان راست‌چین
 * خودکار معکوس شوند.
 */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  /** متن جایگزین هنگام بارگذاری. پیش‌فرض «در حال بارگذاری…». */
  loadingText?: string;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/50',
  secondary: 'bg-muted text-foreground hover:bg-muted/80',
  danger:
    'bg-danger text-danger-foreground hover:bg-danger/90 disabled:bg-danger/50',
  ghost: 'bg-transparent text-foreground hover:bg-muted',
  outline: 'border border-border bg-transparent text-foreground hover:bg-muted',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      loadingText,
      disabled,
      children,
      type = 'button',
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        // نوع پیش‌فرض عمداً `button` است نه `submit`: دکمه‌ای که ناخواسته فرم
        // را ارسال کند، در صفحات مالی خطای واقعی می‌سازد.
        type={type}
        disabled={disabled || isLoading}
        aria-busy={isLoading}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-md font-medium',
          'transition-colors disabled:cursor-not-allowed disabled:opacity-60',
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className,
        )}
        {...props}
      >
        {isLoading ? (
          <>
            <span
              className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
            <span>{loadingText ?? COMMON.loading}</span>
          </>
        ) : (
          children
        )}
      </button>
    );
  },
);
