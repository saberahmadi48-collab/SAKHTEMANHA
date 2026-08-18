import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import { ERRORS } from '@bops/i18n';
import type { Request, Response } from 'express';

/**
 * فیلتر سراسری استثناها — آخرین سد در برابر نشت متن انگلیسی به رابط کاربری.
 *
 * چرا لازم است: حتی وقتی همه‌ی پیام‌های خودمان فارسی باشند، خود NestJS برای
 * وضعیت‌هایی که ما پرتاب نمی‌کنیم متن انگلیسی تولید می‌کند:
 *   - مسیر ناموجود   → «Cannot GET /api/foo»
 *   - خطای داخلی     → «Internal server error»
 *   - محدودیت نرخ    → «ThrottlerException: Too Many Requests»
 *   - بدنه‌ی نامعتبر  → «Unexpected token in JSON»
 * این‌ها مستقیماً در Toast کلاینت می‌نشینند و دقیقاً مصداق «پیام‌های پیش‌فرض
 * انگلیسی کتابخانه‌ها» هستند که ممنوع اعلام شده.
 *
 * دو تصمیم مهم:
 *   ۱. خطای ۵۰۰ هرگز جزئیات فنی را به کاربر نشان نمی‌دهد. پیام واقعی فقط در
 *      لاگ سرور می‌رود؛ کاربر یک جمله‌ی فارسی امن می‌بیند. این هم تجربه‌ی
 *      کاربری بهتری است و هم جلوی افشای ساختار داخلی به مهاجم را می‌گیرد.
 *   ۲. پاسخ‌های اعتبارسنجی که خودمان با ساختار `errors` ساخته‌ایم دست‌نخورده
 *      عبور می‌کنند تا فرم بتواند خطا را زیر فیلد درست بنشاند.
 */
@Catch()
export class PersianExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PersianExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // پاسخ ۵۰۰: جزئیات فقط به لاگ می‌رود، نه به کاربر.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled ${status} on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      response.status(status).json({
        statusCode: status,
        message: ERRORS.serverError,
        path: request.url,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const body = this.buildBody(exception, status);
    response.status(status).json({
      ...body,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  /** ساخت بدنه‌ی فارسی برای خطاهای ۴xx. */
  private buildBody(
    exception: unknown,
    status: number,
  ): Record<string, unknown> {
    if (exception instanceof HttpException) {
      const payload = exception.getResponse();

      // پاسخ‌های ساختاریافته‌ی خودمان (خروجی persianValidationPipeOptions)
      // از قبل فارسی‌اند و نقشه‌ی خطای هر فیلد را دارند — دست نمی‌زنیم.
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'errors' in payload
      ) {
        return payload as Record<string, unknown>;
      }

      const rawMessage =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: unknown }).message ?? '');

      const message = Array.isArray(rawMessage)
        ? rawMessage.join(' ')
        : String(rawMessage);

      return {
        statusCode: status,
        // اگر پیام از کد خودمان آمده باشد فارسی است و حفظ می‌شود؛ اگر متن
        // پیش‌فرض انگلیسی Nest باشد، با معادل فارسی جایگزین می‌گردد.
        message: this.isPersian(message)
          ? message
          : this.fallbackForStatus(status),
      };
    }

    return { statusCode: status, message: this.fallbackForStatus(status) };
  }

  /**
   * آیا متن حاوی حروف فارسی/عربی هست؟
   * ملاک «حاوی بودن» است نه «کاملاً فارسی بودن»، چون پیام‌های مشروع ما ممکن
   * است کد مجوز لاتین (`building:update`) را در خود داشته باشند.
   */
  private isPersian(text: string): boolean {
    return /[\u0600-\u06FF]/.test(text);
  }

  /** پیام فارسی پیش‌فرض بر اساس کد وضعیت. */
  private fallbackForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ERRORS.validationFailed;
      case HttpStatus.UNAUTHORIZED:
        return ERRORS.unauthenticated;
      case HttpStatus.FORBIDDEN:
        return ERRORS.forbidden;
      case HttpStatus.NOT_FOUND:
        return ERRORS.notFound;
      case HttpStatus.CONFLICT:
        return ERRORS.conflict;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ERRORS.tooManyRequests;
      case HttpStatus.REQUEST_TIMEOUT:
        return ERRORS.timeout;
      default:
        return ERRORS.serverError;
    }
  }
}
