import * as React from 'react';
import { COMMON, EMPTY_STATES } from '@bops/i18n';

import { cn } from '@/lib/cn';
import { Button } from './button';

/**
 * حالت خالی و حالت خطا — هر دو با متن فارسی.
 *
 * چرا این کامپوننت وجود دارد: حالت خالی جایی است که متن انگلیسی بیش از همه
 * جا می‌ماند، چون کمتر دیده می‌شود و در تست دستی از قلم می‌افتد. با اجباری
 * کردن عبور از این کامپوننت، متن‌های پیش‌فرض همیشه از فرهنگ فارسی می‌آیند.
 */

export interface EmptyStateProps {
  /** عنوان فارسی؛ پیش‌فرض «نتیجه‌ای یافت نشد». */
  title?: string;
  /** توضیح کوتاه فارسی زیر عنوان. */
  hint?: string;
  /** متن دکمه‌ی اقدام (مثلاً «افزودن ساختمان»). */
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState({
  title = EMPTY_STATES.noResults,
  hint = EMPTY_STATES.noResultsHint,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg',
        'border border-dashed border-border bg-card/50 px-6 py-12 text-center',
        className,
      )}
    >
      <p className="text-base font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>
      {actionLabel && onAction && (
        <Button onClick={onAction} size="sm" className="mt-2">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export interface ErrorStateProps {
  /** پیام خطای فارسی دریافتی از API. */
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  message,
  onRetry,
  className,
}: ErrorStateProps): React.JSX.Element {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg',
        'border border-danger/30 bg-danger/5 px-6 py-12 text-center',
        className,
      )}
    >
      <p className="text-base font-medium text-danger">
        {EMPTY_STATES.errorTitle}
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {message ?? EMPTY_STATES.errorHint}
      </p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline" size="sm" className="mt-2">
          {COMMON.retry}
        </Button>
      )}
    </div>
  );
}

/** حالت بارگذاری با متن فارسی برای صفحه‌خوان. */
export function LoadingState({
  label = COMMON.loading,
  className,
}: {
  label?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-12',
        className,
      )}
    >
      <span
        className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
        aria-hidden="true"
      />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
