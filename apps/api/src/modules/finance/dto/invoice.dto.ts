import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceStatus } from '@prisma/client';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Invoice DTOs — turning obligations into payable documents (BM-03 §21-§25).
 *
 * THE DISTINCTION THAT SHAPES EVERY FIELD HERE: §70 says Charge ≠ Invoice ≠
 * Payment. A charge is "this unit owes this much for this reason"; an invoice is
 * the DOCUMENT that asks for it and may bundle several charges (§22). That is
 * why nothing in this file accepts an amount: the figures come from the charges
 * being invoiced, which came from the rule engine. A client-supplied total would
 * let the document disagree with the ledger it is supposed to represent, and the
 * ledger is the source of truth (§7).
 */

/**
 * Issues invoices for a whole period — the step that follows charge generation
 * in the §50 monthly flow.
 *
 * ONE INVOICE PER UNIT, bundling every uninvoiced charge that unit has in the
 * period (§22). Issuing per charge instead would send a resident four separate
 * documents for one month, and §22's own example shows the opposite: one invoice
 * listing monthly charge, elevator repair, cleaning, extraordinary charge.
 *
 * Deliberately NOT accepting a list of charge ids. Which charges are outstanding
 * is a question the database answers correctly and a client answers with a stale
 * screen — and a client that omitted one would leave an obligation silently
 * unbilled with no error anywhere.
 */
export class IssueInvoicesDto {
  @ApiPropertyOptional({
    description:
      'شناسه دوره مالی — در صورت نبود، دوره جاری استفاده می‌شود',
  })
  @IsOptional()
  @IsUUID()
  financialPeriodId?: string;

  /** Narrows issuance to one unit; omitted, every unit with charges is invoiced. */
  @ApiPropertyOptional({ description: 'صدور فقط برای یک واحد' })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  /**
   * Overrides the due date derived from `BuildingSettings.chargeDueDay`.
   *
   * Accepted because a building may agree a different deadline for an
   * extraordinary assessment; refused by the service if it falls before the
   * issue date, which would be a deadline nobody could meet (§24).
   */
  @ApiPropertyOptional({ description: 'مهلت پرداخت — پیش‌فرض از تنظیمات ساختمان' })
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'یادداشت روی صورت‌حساب' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * Cancels an issued invoice (§24).
 *
 * A reason is mandatory and not decorative: cancelling releases the charges back
 * to uninvoiced so they can be billed again, which is exactly the operation an
 * auditor will want explained. §24 also forbids simply deleting a paid invoice —
 * the service refuses cancellation once any payment has landed and directs the
 * caller to a reversal instead.
 */
export class CancelInvoiceDto {
  @ApiProperty({ description: 'دلیل ابطال صورت‌حساب' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ListInvoicesQueryDto {
  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  financialPeriodId?: string;
}

/**
 * One billed charge as it appears on the document (§22).
 *
 * The description and amounts are the values COPIED onto the line at issue time,
 * never read through to the charge. An invoice whose wording changes because
 * master data was edited afterwards is not evidence of what was billed.
 */
export interface InvoiceLineResponse {
  id: string;
  chargeId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  sortOrder: number;
}

/**
 * Every money field goes through `toAmount()` and lands as a `number`.
 *
 * A raw `Prisma.Decimal` serialises through JSON.stringify as
 * `{"s":1,"e":6,"d":[...]}` and reaches the client as NaN — a bug this codebase
 * has already paid for once on `sharePercent` in BM-01, and the reason the whole
 * finance API is one numeric shape rather than a mix of numbers and strings.
 */
export interface InvoiceResponse {
  id: string;
  unitId: string;
  financialPeriodId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  discount: number;
  penalty: number;
  total: number;
  paidAmount: number;
  balance: number;
  status: string;
  issuedAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  notes: string | null;
  lines: InvoiceLineResponse[];
}

/**
 * The outcome of a bulk issue.
 *
 * `unitsSkipped` is reported alongside `invoicesIssued` for the same reason
 * `unitsEvaluated` is reported on a charge run: an issue that produced 12
 * invoices in a 40-unit building succeeded and is still probably wrong, and that
 * is invisible if only the success count is published.
 */
export interface IssueInvoicesResponse {
  financialPeriodId: string;
  invoicesIssued: number;
  unitsSkipped: number;
  totalAmount: number;
  invoices: InvoiceResponse[];
}
