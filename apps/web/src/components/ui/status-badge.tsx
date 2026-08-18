import * as React from 'react';
import { statusLabel, statusVariant, type StatusVariant } from '@bops/i18n';

import { cn } from '@/lib/cn';

/**
 * نشان وضعیت با برچسب فارسی.
 *
 * مقدار خام enum (`ACTIVE`) را می‌گیرد و «فعال» نمایش می‌دهد. اگر مقدار
 * ناشناخته‌ای از API بیاید، «نامشخص» نشان داده می‌شود نه رشته‌ی انگلیسی خام —
 * این همان نشتی است که در رابط‌های چندزبانه معمولاً از قلم می‌افتد.
 *
 * رنگ هرگز تنها حامل معنا نیست: متن فارسی همیشه کنار رنگ هست، پس کاربر
 * نابینای رنگ هم وضعیت را می‌فهمد.
 */

const VARIANT_CLASSES: Record<StatusVariant, string> = {
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  danger: 'bg-danger/10 text-danger border-danger/20',
  neutral: 'bg-muted text-muted-foreground border-border',
};

export interface StatusBadgeProps {
  /** مقدار خام enum از API، مثلاً `ACTIVE`. */
  status: string;
  className?: string;
}

export function StatusBadge({
  status,
  className,
}: StatusBadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        VARIANT_CLASSES[statusVariant(status)],
        className,
      )}
    >
      {statusLabel(status)}
    </span>
  );
}
