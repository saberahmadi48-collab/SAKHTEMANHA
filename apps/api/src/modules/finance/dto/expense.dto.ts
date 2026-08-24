import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ExpenseStatus,
  FinancialCategoryKind,
  IncomeSourceType,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Expense, income and financial-category DTOs (BM-03 §38-§42).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO SHAPING RULES, and why the file looks the way it does.
 *
 * 1. THE APPROVAL CHAIN IS A SEQUENCE OF SEPARATE ACTIONS, NOT A STATUS FIELD
 *    THE CALLER SETS. There is no `status` anywhere in the create/update DTOs.
 *    Accepting one would let a client POST an expense already `PAID` and skip
 *    every authority check §39 exists to impose — the state machine would become
 *    advisory. Each transition is its own endpoint with its own permission.
 *
 * 2. AMOUNT IS TRUSTED HERE, UNLIKE ON THE PAYMENT PATH. §63 forbids trusting a
 *    client amount for what a RESIDENT OWES, because the server can derive that
 *    from the invoice. A supplier's bill has no server-side oracle to derive it
 *    from — the number is on the paper in the manager's hand. The control is not
 *    derivation but separation of duties: entering the figure and approving it
 *    are different permissions held by different roles.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ============================================================================
//  Financial categories (§42)
// ============================================================================

/**
 * Creates a category in the building's chart of accounts.
 *
 * `kind` is set once and never changes — there is deliberately no `kind` on the
 * update DTO. Flipping "Elevator" from expense to income mid-year would silently
 * rewrite what every prior report meant.
 */
export class CreateFinancialCategoryDto {
  @ApiProperty({
    enum: FinancialCategoryKind,
    description: 'سمت دفتر — درآمد یا هزینه. پس از ایجاد تغییر نمی‌کند',
  })
  @IsEnum(FinancialCategoryKind)
  kind!: FinancialCategoryKind;

  @ApiProperty({ description: 'نام دسته‌بندی (فارسی)' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ description: 'توضیحات' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'ترتیب نمایش', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/**
 * Renames or retires a category.
 *
 * `isActive: false` is the deletion path, and the only one. A category with
 * history behind it cannot be removed without orphaning last year's books, so
 * retiring it is offered instead of a DELETE that would have to be refused.
 */
export class UpdateFinancialCategoryDto {
  @ApiPropertyOptional({ description: 'نام دسته‌بندی' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'توضیحات' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: 'غیرفعال‌سازی — جایگزین حذف، تاریخچه حفظ می‌شود',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'ترتیب نمایش' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ListFinancialCategoriesQueryDto {
  @ApiPropertyOptional({ enum: FinancialCategoryKind })
  @IsOptional()
  @IsEnum(FinancialCategoryKind)
  kind?: FinancialCategoryKind;

  /**
   * A QUERY-STRING boolean, so it arrives as the string "false", not `false`.
   *
   * The global pipe runs with `enableImplicitConversion: false` on purpose, so
   * nothing coerces it for us and a bare `@IsBoolean()` rejects every value a
   * browser can actually send. This transform is the explicit conversion that
   * keeps the strict pipe and still lets `?activeOnly=false` work.
   */
  @ApiPropertyOptional({ description: 'فقط دسته‌بندی‌های فعال', default: true })
  @IsOptional()
  @Transform(({ value }) => toQueryBoolean(value))
  @IsBoolean()
  activeOnly?: boolean;
}

/** Turns a query-string flag into a real boolean, leaving anything else alone
 *  so `@IsBoolean()` still reports a genuinely bad value rather than silently
 *  reading it as false. */
function toQueryBoolean(value: unknown): unknown {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}

export interface FinancialCategoryResponse {
  id: string;
  kind: string;
  name: string;
  systemKey: string | null;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

// ============================================================================
//  Expenses (§38/§39)
// ============================================================================

/**
 * Enters a supplier bill as a DRAFT. No financial effect whatsoever.
 *
 * `invoiceReference` is optional but load-bearing when present: together with
 * the vendor name it forms the unique constraint that stops the same contractor
 * invoice being entered — and later paid — twice.
 */
export class CreateExpenseDto {
  @ApiProperty({ description: 'دسته‌بندی هزینه' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ description: 'نام فروشنده یا پیمانکار' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  vendorName!: string;

  @ApiProperty({ description: 'شرح هزینه' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({
    description: 'شماره فاکتور یا رسید فروشنده — مبنای جلوگیری از ثبت تکراری',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  invoiceReference?: string;

  @ApiProperty({ description: 'مبلغ هزینه (ریال)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ description: 'تاریخ هزینه (ISO)' })
  @IsDateString()
  expenseDate!: string;
}

/** Edits a DRAFT expense. Refused once the expense has been submitted. */
export class UpdateExpenseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  vendorName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  invoiceReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expenseDate?: string;
}

/**
 * Rejects a submitted expense. The reason is mandatory.
 *
 * A refusal with no reason is not a decision anyone can act on — the manager
 * cannot tell whether to fix the document or drop the supplier.
 */
export class RejectExpenseDto {
  @ApiProperty({ description: 'دلیل رد هزینه' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/**
 * Records that an APPROVED expense actually left the building's account. This is
 * the one transition with a ledger effect.
 *
 * `financialPeriodId` is optional and normally omitted: the service resolves the
 * open period itself. It exists for the case where an expense is paid against a
 * month that is still open but is not today's.
 */
export class PayExpenseDto {
  @ApiPropertyOptional({
    description: 'دوره مالی — در صورت نبود، دوره باز جاری استفاده می‌شود',
  })
  @IsOptional()
  @IsUUID()
  financialPeriodId?: string;

  @ApiPropertyOptional({ description: 'تاریخ پرداخت (ISO) — پیش‌فرض اکنون' })
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @ApiPropertyOptional({ description: 'یادداشت' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListExpensesQueryDto {
  @ApiPropertyOptional({ enum: ExpenseStatus })
  @IsOptional()
  @IsEnum(ExpenseStatus)
  status?: ExpenseStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  financialPeriodId?: string;
}

/**
 * Money fields are `number` via `toAmount()`, never a raw `Prisma.Decimal` —
 * a Decimal serialises to `{"s":1,"e":6,"d":[...]}` and reaches the client as
 * NaN. The same rule as every other finance DTO in this module.
 */
export interface ExpenseResponse {
  id: string;
  categoryId: string;
  categoryName: string | null;
  financialPeriodId: string | null;
  vendorName: string;
  description: string;
  invoiceReference: string | null;
  amount: number;
  currency: string;
  expenseDate: string;
  status: string;
  /** Null until PAID — the structural expression of "approved ≠ paid". */
  ledgerEntryId: string | null;
  createdByPersonId: string | null;
  approvedByPersonId: string | null;
  decisionReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

// ============================================================================
//  Income (§41)
// ============================================================================

/**
 * Records income that arrived OUTSIDE the charge pipeline.
 *
 * There is no `CHARGE` option in `IncomeSourceType`, and that absence is the
 * point: monthly charge income already reaches the ledger as
 * Charge → Invoice → Payment. Recording it here as well would count the same
 * rial twice in every report.
 */
export class RecordIncomeDto {
  @ApiProperty({ description: 'دسته‌بندی درآمد' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ description: 'مبلغ دریافتی (ریال)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ description: 'تاریخ دریافت (ISO)' })
  @IsDateString()
  receivedAt!: string;

  @ApiProperty({ enum: IncomeSourceType, description: 'منشأ درآمد' })
  @IsEnum(IncomeSourceType)
  sourceType!: IncomeSourceType;

  @ApiProperty({ description: 'شرح درآمد' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ description: 'نوع سند مرجع (مثلاً قرارداد اجاره)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  referenceType?: string;

  @ApiPropertyOptional({ description: 'شناسه سند مرجع' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  referenceId?: string;

  @ApiPropertyOptional({
    description: 'دوره مالی — در صورت نبود، دوره باز جاری استفاده می‌شود',
  })
  @IsOptional()
  @IsUUID()
  financialPeriodId?: string;
}

export class ListIncomesQueryDto {
  @ApiPropertyOptional({ enum: IncomeSourceType })
  @IsOptional()
  @IsEnum(IncomeSourceType)
  sourceType?: IncomeSourceType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  financialPeriodId?: string;
}

export interface IncomeResponse {
  id: string;
  categoryId: string;
  categoryName: string | null;
  financialPeriodId: string;
  amount: number;
  currency: string;
  receivedAt: string;
  sourceType: string;
  referenceType: string | null;
  referenceId: string | null;
  description: string;
  ledgerEntryId: string | null;
  recordedByPersonId: string | null;
  createdAt: string;
}

// ============================================================================
//  Building financial summary (§53)
// ============================================================================

export class BuildingFinancialSummaryQueryDto {
  @ApiPropertyOptional({
    description: 'دوره مالی — در صورت نبود، کل تاریخچه ساختمان',
  })
  @IsOptional()
  @IsUUID()
  financialPeriodId?: string;
}

/**
 * The manager dashboard figures of §53.
 *
 * `netPosition` is `income - expenses` over the SAME window, where income counts
 * only what was actually collected (ledger CREDITs) rather than what was
 * invoiced. A dashboard that showed billed-but-unpaid money as income would tell
 * a manager they can afford a repair they cannot.
 *
 * `pendingExpenseTotal` is reported separately and deliberately NOT subtracted:
 * an approved-but-unpaid bill has not left the account yet, but a manager about
 * to commit the balance needs to see it coming.
 */
export interface BuildingFinancialSummaryResponse {
  financialPeriodId: string | null;
  currency: string;
  /** Collected income — building-level CREDITs plus settled unit payments. */
  incomeTotal: number;
  /** Expenses that actually left the account (status PAID). */
  expenseTotal: number;
  netPosition: number;
  /** Approved but not yet paid — committed money still in the account. */
  pendingExpenseTotal: number;
  /** What residents still owe: SUM(debits) - SUM(credits) over unit entries. */
  outstandingReceivable: number;
  unpaidUnitCount: number;
  expenseCountByStatus: Record<string, number>;
}
