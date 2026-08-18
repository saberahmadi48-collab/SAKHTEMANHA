import * as React from 'react';
import { COMMON, toLatinDigits, toPersianDigits } from '@bops/i18n';

import { cn } from '@/lib/cn';

/**
 * فیلد ورودی با برچسب، خطا و راهنما — همه فارسی.
 *
 * سه مسئله‌ی واقعی رابط فارسی که اینجا حل شده‌اند:
 *
 * ۱. «اختیاری» به‌جای ستاره‌ی قرمز برای الزامی: در فرم‌های فارسی، علامت‌گذاری
 *    فیلدهای اختیاری خوانا‌تر از علامت‌گذاری الزامی‌هاست، چون اکثر فیلدها
 *    الزامی‌اند و صفحه پر از ستاره می‌شود.
 *
 * ۲. اتصال خطا به ورودی با `aria-describedby` و `aria-invalid`. بدون این،
 *    صفحه‌خوان پیام خطای فارسی را نمی‌خواند و فیلد سالم به نظر می‌رسد.
 *
 * ۳. فیلد عددی: کاربر فارسی «۱۲۳۴» تایپ می‌کند. اگر خام به سرور برود،
 *    اعتبارسنجی عددی رد می‌شود. `NumberField` ارقام را پیش از ارسال به
 *    لاتین نرمال می‌کند ولی نمایش را فارسی نگه می‌دارد.
 */

export interface FieldProps {
  /** برچسب فارسی فیلد. */
  label: string;
  /** شناسه‌ی عنصر ورودی — برای اتصال <label> و پیام خطا. */
  htmlFor: string;
  /** پیام خطای فارسی؛ معمولاً از پاسخ اعتبارسنجی API می‌آید. */
  error?: string | undefined;
  /** متن راهنمای زیر فیلد. */
  hint?: string | undefined;
  /** پیش‌فرض true؛ فیلدهای اختیاری با برچسب «اختیاری» مشخص می‌شوند. */
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required = true,
  children,
  className,
}: FieldProps): React.JSX.Element {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-2 text-sm font-medium text-foreground"
      >
        <span>{label}</span>
        {!required && (
          <span className="text-xs font-normal text-muted-foreground">
            ({COMMON.optional})
          </span>
        )}
      </label>

      {children}

      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}

      {error && (
        // role="alert" باعث می‌شود صفحه‌خوان بلافاصله خطا را اعلام کند.
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export interface TextInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ className, hasError = false, ...props }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={hasError || undefined}
        className={cn(
          'h-10 w-full rounded-md border bg-card px-3 text-sm',
          'placeholder:text-muted-foreground',
          'disabled:cursor-not-allowed disabled:bg-muted',
          hasError ? 'border-danger' : 'border-input',
          className,
        )}
        {...props}
      />
    );
  },
);

export interface NumberFieldProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'onChange' | 'value' | 'type'
  > {
  value: number | null;
  onValueChange: (value: number | null) => void;
  hasError?: boolean;
}

/**
 * ورودی عددی با نمایش فارسی و مقدار لاتین.
 *
 * چرا `type="text"` و نه `type="number"`: مرورگر در حالت `number` ارقام فارسی
 * را نمی‌پذیرد و فیلد را خالی نشان می‌دهد. با `inputMode="numeric"` صفحه‌کلید
 * عددی روی موبایل باز می‌شود بدون اینکه ورودی فارسی رد شود.
 */
export const NumberField = React.forwardRef<
  HTMLInputElement,
  NumberFieldProps
>(function NumberField(
  { className, value, onValueChange, hasError = false, ...props },
  ref,
) {
  const [text, setText] = React.useState<string>(
    value === null ? '' : toPersianDigits(value),
  );

  // همگام‌سازی با مقدار بیرونی (مثلاً وقتی فرم ریست می‌شود).
  React.useEffect(() => {
    const normalized = value === null ? '' : toPersianDigits(value);
    setText((current) =>
      toLatinDigits(current) === String(value ?? '') ? current : normalized,
    );
  }, [value]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value;
    setText(raw);

    const latin = toLatinDigits(raw).replace(/[^\d.-]/g, '');
    if (latin === '') {
      onValueChange(null);
      return;
    }
    const parsed = Number(latin);
    onValueChange(Number.isNaN(parsed) ? null : parsed);
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      value={text}
      onChange={handleChange}
      aria-invalid={hasError || undefined}
      className={cn(
        'h-10 w-full rounded-md border bg-card px-3 text-sm',
        'placeholder:text-muted-foreground',
        hasError ? 'border-danger' : 'border-input',
        className,
      )}
      {...props}
    />
  );
});
