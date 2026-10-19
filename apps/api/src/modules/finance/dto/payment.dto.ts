import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Payment DTOs — money arriving, and what may be trusted about it (BM-03
 * §25-§29, §33-§36).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THAT SHAPES THIS FILE: §63 — Client Amount ≠ Trusted Amount.
 *
 * `RecordManualPaymentDto` DOES carry an amount, and that is not a contradiction
 * of the rule — it is the rule's exception, drawn deliberately. A manual payment
 * is a HUMAN ASSERTION that cash or a transfer was received; there is no oracle
 * to ask, so the number necessarily comes from the recorder. §36 is what makes
 * that safe rather than reckless: elevated permission, mandatory reference,
 * audited creator. A gateway payment is the opposite case — the amount comes
 * back from verification, never from the browser — which is why the (future)
 * BM-04 verify path takes no amount from the client at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Records money received outside any gateway — the controlled fallback of §36.
 *
 * `reference` is REQUIRED and is not bookkeeping decoration. It is half of the
 * `(provider, providerTransactionId)` unique constraint, which is what stops a
 * double-clicked "record payment" from settling the same bank transfer twice
 * (§35). A manual payment with no reference could be entered ten times over and
 * the database would have no way to know.
 *
 * `invoiceId` is OPTIONAL on purpose. Residents pay in advance, pay a round
 * number, or pay before an invoice exists. Money received with no document
 * attached settles nothing and becomes credit (§26/§27) rather than being
 * refused — refusing it is how a system teaches its users to write the amount
 * on a sticky note instead.
 */
export const SUPPORTED_PAYMENT_PROVIDERS = ['AP', '724'] as const;
export type SupportedPaymentProvider =
  (typeof SUPPORTED_PAYMENT_PROVIDERS)[number];

export class RecordManualPaymentDto {
  @ApiProperty({ description: 'شناسه واحد پرداخت‌کننده' })
  @IsUUID()
  unitId!: string;

  @ApiPropertyOptional({
    description:
      'صورت‌حساب هدف — در صورت نبود، پرداخت به‌صورت اعتبار روی حساب واحد می‌نشیند',
  })
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  /**
   * The recorder's assertion of what was received. Validated as positive because
   * direction carries the sign in the ledger (§8) — a negative "payment" would be
   * a charge wearing the wrong name, and there is a reversal path for that (§46).
   */
  @ApiProperty({ description: 'مبلغ دریافتی (ریال)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({
    enum: PaymentMethod,
    description: 'روش دریافت — نقدی، انتقال بانکی یا کارتخوان',
  })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  /**
   * Receipt / tracking number. §36 requires it, and the unique constraint makes
   * the requirement real rather than advisory.
   */
  @ApiProperty({ description: 'شماره پیگیری یا رسید — الزامی' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  reference!: string;

  @ApiPropertyOptional({
    description: 'دوره مالی — در صورت نبود، دوره جاری استفاده می‌شود',
  })
  @IsOptional()
  @IsUUID()
  financialPeriodId?: string;

  @ApiPropertyOptional({ description: 'یادداشت' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/**
 * Reverses a settled payment (§46).
 *
 * Deliberately NOT a delete, and deliberately not an "edit the amount". A
 * bounced cheque or a mis-keyed receipt is corrected by writing the opposing
 * ledger entry so both the money and its undoing stay visible — §70: Deleted
 * Transaction ≠ Correction.
 */
export class CreateProviderPaymentIntentDto {
  @ApiProperty({
    description: 'درگاه پرداخت انتخابی',
    enum: SUPPORTED_PAYMENT_PROVIDERS,
  })
  @IsEnum(SUPPORTED_PAYMENT_PROVIDERS)
  provider!: SupportedPaymentProvider;

  @ApiProperty({ description: 'شناسه واحد پرداخت‌کننده' })
  @IsUUID()
  unitId!: string;

  @ApiProperty({ description: 'صورت‌حساب هدف' })
  @IsUUID()
  invoiceId!: string;

  @ApiProperty({ description: 'کلید یک‌بار مصرف برای جلوگیری از تکرار' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  idempotencyKey!: string;

  @ApiPropertyOptional({ description: 'یادداشت' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class VerifyProviderPaymentIntentDto {
  @ApiProperty({
    description: 'درگاه پرداخت انتخابی',
    enum: SUPPORTED_PAYMENT_PROVIDERS,
  })
  @IsEnum(SUPPORTED_PAYMENT_PROVIDERS)
  provider!: SupportedPaymentProvider;

  @ApiProperty({ description: 'کلید یک‌بار مصرف ثبت‌شده هنگام ایجاد intent' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  idempotencyKey!: string;

  @ApiProperty({ description: 'شناسه تراکنش واقعی ارائه‌دهنده' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  providerTransactionId!: string;
}

export class ReversePaymentDto {
  @ApiProperty({ description: 'دلیل برگشت پرداخت' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ListPaymentsQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  financialPeriodId?: string;
}

/**
 * Applies a unit's existing credit to an outstanding invoice (§27).
 *
 * No amount is accepted: the service applies the smaller of "credit available"
 * and "invoice still owed". Letting the caller name a figure would allow
 * applying more credit than exists, or more than the invoice needs — both of
 * which produce a balance that no ledger entry justifies.
 */
export class ApplyCreditDto {
  @ApiProperty({ description: 'صورت‌حسابی که اعتبار روی آن اعمال می‌شود' })
  @IsUUID()
  invoiceId!: string;

  @ApiPropertyOptional({ description: 'یادداشت' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListCreditsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  unitId?: string;
}

/** Statement query — how far back the unit's ledger view reaches. */
export class UnitStatementQueryDto {
  @ApiPropertyOptional({ description: 'حداکثر تعداد سطر دفتر کل', default: 100 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  take?: number;
}

/**
 * Every money field is a `number` produced by `toAmount()`, never a raw
 * `Prisma.Decimal` — see the note in `invoice.dto.ts`; a Decimal reaches the
 * client as NaN.
 */
export interface PaymentResponse {
  id: string;
  unitId: string;
  invoiceId: string | null;
  financialPeriodId: string;
  provider: string;
  providerTransactionId: string | null;
  method: string;
  amount: number;
  /** How much of `amount` the invoice consumed. The rest became credit (§26). */
  settledAmount: number;
  /** `amount - settledAmount`, surfaced so overpayment is visible without maths. */
  creditedAmount: number;
  currency: string;
  status: string;
  ledgerEntryId: string | null;
  note: string | null;
  requestedAt: string;
  verifiedAt: string | null;
  /** The invoice's state AFTER this payment — PARTIALLY_PAID or PAID (§25). */
  invoiceStatus: string | null;
  /** What the invoice still owes after this payment. */
  invoiceBalance: number | null;
}

export interface ProviderPaymentIntentResponse {
  id: string;
  unitId: string;
  invoiceId: string | null;
  financialPeriodId: string;
  provider: string;
  providerTransactionId: string | null;
  amount: number;
  settledAmount: number;
  status: string;
  note: string | null;
  requestedAt: string;
  verifiedAt: string | null;
}

export interface UnitCreditResponse {
  id: string;
  unitId: string;
  amount: number;
  remainingAmount: number;
  currency: string;
  status: string;
  sourceReferenceType: string;
  sourceReferenceId: string | null;
  note: string | null;
  createdAt: string;
}

export interface ApplyCreditResponse {
  invoiceId: string;
  appliedAmount: number;
  invoiceBalance: number;
  invoiceStatus: string;
  remainingCredit: number;
  creditsUsed: string[];
}

/** One ledger row as a resident sees it on their statement (§54). */
export interface StatementLineResponse {
  id: string;
  occurredAt: string;
  direction: string;
  amount: number;
  referenceType: string;
  referenceId: string | null;
  description: string | null;
}

/**
 * A unit's financial position (§28).
 *
 * `outstanding` is DERIVED from ledger entries — SUM(debits) - SUM(credits) —
 * not read from a stored column. Positive means the unit owes the building.
 * `availableCredit` is reported separately rather than folded into the balance:
 * a unit owing 500,000 while holding 200,000 of unapplied credit is a real and
 * distinct state from one owing 300,000, and collapsing the two hides why.
 */
export interface UnitStatementResponse {
  unitId: string;
  debit: number;
  credit: number;
  outstanding: number;
  availableCredit: number;
  openInvoiceCount: number;
  lines: StatementLineResponse[];
}
