import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * ترکیب کلاس‌های Tailwind با حل تعارض.
 * `twMerge` تضمین می‌کند کلاس بعدی، کلاس هم‌گروه قبلی را بازنویسی کند
 * (مثلاً `px-2 px-4` نتیجه‌اش `px-4` شود) تا override در کامپوننت‌ها کار کند.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
