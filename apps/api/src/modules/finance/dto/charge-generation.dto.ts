import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * Request body for running monthly charge generation (BM-03 §50).
 *
 * DELIBERATELY ALMOST EMPTY, and that is the point. §2/§71 promise a manager
 * CONFIGURES the system rather than typing what each resident owes, so the run
 * takes no amounts, no unit list and no rule selection — every one of those
 * already lives in the charge rules and the unit master data. Accepting them
 * here would reopen the manual-entry door the whole milestone exists to close,
 * and would let two runs of "the same month" produce different numbers.
 *
 * `financialPeriodId` is optional so the common case is one click: omitted, the
 * service uses the current period and opens it if the building has not yet
 * (§50 — "Month Starts -> Open Financial Period"). It is accepted at all only
 * for the late run — generating Mehr during Aban — which must target the month
 * it belongs to rather than today's.
 */
export class GenerateChargesDto {
  @ApiPropertyOptional({
    description:
      'شناسه دوره مالی — در صورت نبود، دوره جاری استفاده و در صورت لزوم باز می‌شود',
  })
  @IsOptional()
  @IsUUID()
  financialPeriodId?: string;
}

/**
 * The result of a run, as the "was this month generated?" screen reads it.
 *
 * `unitsEvaluated` is reported ALONGSIDE `chargesCreated` on purpose: a run
 * that evaluated 40 units and wrote 12 charges completed successfully and is
 * still probably wrong — a rule targeting the wrong unit kinds looks identical
 * to a correct run if you only publish the count of charges written.
 *
 * `totalAmount` MUST go through `toAmount()` and never carry a raw
 * `Prisma.Decimal`: a Decimal serialises through JSON.stringify as
 * `{"s":1,"e":6,"d":[...]}` and reaches the client as NaN — the exact bug
 * already paid for once on `sharePercent` in BM-01. `toAmount` returns a
 * `number`, matching `FinancialPeriodResponse.totals`; the whole finance API
 * stays one shape rather than mixing numeric and stringified money.
 */
export interface ChargeRunResponse {
  id: string;
  financialPeriodId: string;
  unitsEvaluated: number;
  chargesCreated: number;
  invoicesIssued: number;
  totalAmount: number;
  startedAt: string;
  completedAt: string | null;
  failureReason: string | null;
}
