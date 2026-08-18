import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Financial period DTOs (BM-03 §9/§10/§59).
 *
 * Year and month are JALALI. The client sends 1404/7, not 2025/9 — the platform
 * is Persian-first and the accounting month residents recognise is the Jalali
 * one. The absolute instants the period covers are computed server-side from
 * these, never accepted from the client, so two clients cannot disagree about
 * where Mehr begins.
 */
export class CreateFinancialPeriodDto {
  @ApiProperty({ example: 1404, description: 'سال شمسی' })
  @IsInt()
  @Min(1300)
  @Max(1600)
  year!: number;

  @ApiProperty({ example: 7, description: 'ماه شمسی (۱ تا ۱۲)' })
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  /**
   * Explicit boundaries, for the rare building whose accounting month does not
   * follow the calendar month. Omitted in the normal case and derived from the
   * Jalali month instead.
   */
  @ApiPropertyOptional({ description: 'آغاز دوره (اختیاری)' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({ description: 'پایان دوره (اختیاری)' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;
}

export class CloseFinancialPeriodDto {
  /**
   * Closing while invoices are unsettled is legitimate — an unpaid charge does
   * not stop a month ending — but it must be a DELIBERATE act, so the caller
   * has to say so rather than discovering it after the fact (§59).
   */
  @ApiPropertyOptional({
    description: 'بستن دوره با وجود صورت‌حساب‌های تسویه‌نشده',
    default: false,
  })
  @IsOptional()
  allowUnsettledInvoices?: boolean;

  @ApiPropertyOptional({ description: 'یادداشت بستن دوره' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ReopenFinancialPeriodDto {
  /**
   * §10 requires elevated permission AND audit to reopen a sealed period. The
   * reason is mandatory because "why is Mehr open again?" is the first question
   * an auditor asks, and the answer must live with the row.
   */
  @ApiProperty({ description: 'دلیل بازگشایی دوره (الزامی)' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

export interface FinancialPeriodResponse {
  id: string;
  year: number;
  month: number;
  startsAt: string;
  endsAt: string;
  status: string;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  /** Aggregate position for the period — the dashboard's headline figures. */
  totals: {
    charged: number;
    collected: number;
    outstanding: number;
  };
}
