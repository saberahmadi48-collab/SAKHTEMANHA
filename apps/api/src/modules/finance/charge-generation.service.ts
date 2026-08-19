import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type ChargeRule,
  type FinancialPeriod,
  type UnitKind,
} from '@prisma/client';
import type { RequestScope } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { TenantScopedRepository } from '../../core/database/tenant-scoped.repository';
import {
  ChargeConfigurationError,
  calculateCharges,
  type UnitChargeInput,
} from '../../core/finance/charge-calculator';
import { LedgerService } from '../../core/finance/ledger.service';
import { toAmount } from '../../core/finance/money';
import { ChargeRulesService } from './charge-rules.service';
import { FinancialPeriodsService } from './financial-periods.service';
import type {
  ChargeRunResponse,
  GenerateChargesDto,
} from './dto/charge-generation.dto';

/**
 * A unit as generation sees it: everything the pure engine needs, PLUS the unit
 * kind used to decide which rules apply to it.
 *
 * `kind` is deliberately kept OUT of `UnitChargeInput`. Rule targeting is a
 * selection concern that happens before calculation; letting it into the engine
 * would give the pure function a second reason to change.
 */
type GeneratableUnit = UnitChargeInput & { kind: UnitKind };

/**
 * Monthly charge generation — the automation §50 requires and §51 must make safe.
 *
 * The whole point of BM-03 is that a manager CONFIGURES the system rather than
 * typing what each resident owes (§2, §71). This service is where that promise
 * is kept: open period + active rules + unit master data go in, charges and
 * ledger entries come out, with no per-resident data entry anywhere.
 *
 * THE HARD PART IS NOT THE ARITHMETIC, IT IS RUNNING IT TWICE.
 *
 * A manager double-clicks; a retry fires; a cron overlaps a manual run. The
 * failure mode is a resident billed twice, which costs real money and real
 * trust. Three independent guards, deliberately redundant:
 *
 *  1. The `charge_runs` unique on (buildingId, financialPeriodId) — the second
 *     run cannot even START. This is a DB constraint, not a read-then-write
 *     check, because the latter races under exactly the double-click it exists
 *     to survive.
 *  2. The partial unique index `charges_one_per_rule_unit_period` — even if a
 *     charge were written by some other path, the duplicate is refused.
 *  3. The ledger's own idempotency key per (rule, unit, period), so a duplicate
 *     financial EFFECT is impossible even if a charge row somehow existed twice.
 *
 * ONE TRANSACTION FOR THE WHOLE RUN. A partial month — some units charged,
 * others not, no error surfaced — is far worse than a failed run, because
 * nobody goes looking for it. Either the month is generated or nothing is.
 */
@Injectable()
export class ChargeGenerationService extends TenantScopedRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly rules: ChargeRulesService,
    private readonly periods: FinancialPeriodsService,
  ) {
    super();
  }

  /** Past runs, newest first — the "was this month generated?" screen. */
  async listRuns(scope: RequestScope): Promise<ChargeRunResponse[]> {
    const runs = await this.prisma.chargeRun.findMany({
      where: this.tenantWhere(scope),
      orderBy: { startedAt: 'desc' },
      take: 50,
    });

    return runs.map(toRunResponse);
  }

  /**
   * Generates every charge for one period (§50).
   *
   * `dto.financialPeriodId` is optional: omitted, the current period is used and
   * opened if the building has not opened it yet, so "run the month" is one
   * click rather than two steps a manager can do out of order.
   */
  async generate(
    scope: RequestScope,
    dto: GenerateChargesDto,
  ): Promise<ChargeRunResponse> {
    const period = dto.financialPeriodId
      ? await this.loadPeriod(scope, dto.financialPeriodId)
      : await this.periods.ensurePeriodFor(scope);

    // Generating into a sealed month would move a figure an auditor has signed
    // off. LedgerService refuses it too, but failing here means we refuse before
    // writing a run row rather than aborting halfway.
    if (period.status === 'CLOSED') {
      throw new ConflictException(ERRORS.periodClosed);
    }

    const rules = await this.rules.rulesInForce(scope, period);
    if (rules.length === 0) {
      throw new ConflictException(ERRORS.chargeRuleNoEligibleUnits);
    }

    const units = await this.loadUnitInputs(scope, period);
    if (units.length === 0) {
      throw new ConflictException(ERRORS.chargeRuleNoEligibleUnits);
    }

    try {
      const run = await this.prisma.$transaction(
        async (tx) => {
          // Guard 1: the run row itself. If this insert loses, the whole
          // transaction aborts before a single charge exists.
          const created = await tx.chargeRun.create({
            data: {
              buildingId: scope.buildingId!,
              financialPeriodId: period.id,
              startedByPersonId: scope.personId ?? null,
            },
          });

          let chargesCreated = 0;
          let total = new Prisma.Decimal(0);

          for (const rule of rules) {
            const eligible = filterUnitsForRule(rule, units);
            if (eligible.length === 0) continue;

            const calculated = this.runEngine(rule, eligible);

            for (const result of calculated) {
              const charge = await tx.charge.create({
                data: {
                  buildingId: scope.buildingId!,
                  unitId: result.unitId,
                  financialPeriodId: period.id,
                  chargeRuleId: rule.id,
                  chargeRunId: created.id,
                  chargeType: rule.chargeType,
                  calculationMethod: rule.calculationMethod,
                  baseAmount: result.baseAmount,
                  calculatedAmount: result.calculatedAmount,
                  status: 'ISSUED',
                  description: rule.name,
                  issuedAt: new Date(),
                },
              });

              // §18 — the frozen proof, written in the same transaction as the
              // charge. A charge without its snapshot is a number nobody can
              // defend six months later.
              await tx.chargeCalculationSnapshot.create({
                data: {
                  chargeId: charge.id,
                  buildingId: scope.buildingId!,
                  formulaVersion: rule.version,
                  chargeRuleId: rule.id,
                  inputs: result.inputs as Prisma.InputJsonValue,
                  values: result.values as Prisma.InputJsonValue,
                  calculatedAmount: result.calculatedAmount,
                },
              });

              // The obligation becomes a ledger fact. DEBIT = the unit owes
              // more. Guard 3 lives in this key.
              await this.ledger.post(tx, scope, {
                unitId: result.unitId,
                financialPeriodId: period.id,
                direction: 'DEBIT',
                amount: result.calculatedAmount,
                referenceType: 'CHARGE',
                referenceId: charge.id,
                description: rule.name,
                idempotencyKey: `charge:${rule.id}:${result.unitId}:${period.id}`,
                occurredAt: new Date(),
              });

              chargesCreated += 1;
              total = total.plus(result.calculatedAmount);
            }
          }

          if (chargesCreated === 0) {
            // Nothing matched. Aborting keeps the run table honest: a run row
            // claiming success with zero charges reads like the month was done.
            throw new ConflictException(ERRORS.chargeRuleNoEligibleUnits);
          }

          const completed = await tx.chargeRun.update({
            where: { id: created.id },
            data: {
              unitsEvaluated: units.length,
              chargesCreated,
              totalAmount: total,
              completedAt: new Date(),
            },
          });

          await this.audit.logInTransaction(tx, scope, {
            action: 'finance.charges.generated',
            resourceType: 'ChargeRun',
            resourceId: created.id,
            after: {
              financialPeriodId: period.id,
              rulesApplied: rules.map((rule) => `${rule.name} v${rule.version}`),
              unitsEvaluated: units.length,
              chargesCreated,
              totalAmount: toAmount(total),
            },
          });

          return completed;
        },
        // Generation touches every unit; the default 5s limit is too tight for a
        // large building on a cold connection pool.
        { timeout: 30_000 },
      );

      return toRunResponse(run);
    } catch (error) {
      throw translateGenerationConflict(error);
    }
  }

  /**
   * Runs the pure engine and converts its refusals into Persian 409s.
   *
   * The engine throws rather than inventing a number when a rule cannot be
   * satisfied (e.g. an area-based rule in a building with no recorded areas).
   * That is the right behaviour — but it must reach the manager as an
   * explanation, not a 500.
   */
  private runEngine(rule: ChargeRule, units: UnitChargeInput[]) {
    try {
      return calculateCharges(
        {
          id: rule.id,
          name: rule.name,
          version: rule.version,
          calculationMethod: rule.calculationMethod,
          configuration: (rule.configuration ?? {}) as Record<string, unknown>,
        },
        units,
      );
    } catch (error) {
      if (error instanceof ChargeConfigurationError) {
        throw new ConflictException(
          ERRORS.chargeRuleConfigInvalid(rule.calculationMethod),
        );
      }
      throw error;
    }
  }

  /**
   * Builds the engine's view of every chargeable unit for THIS period.
   *
   * The resident count comes from the occupancy that overlaps the PERIOD, not
   * from who lives there now (§16). This is the difference between "Mehr's
   * invoice says 3 people" staying true forever, and it silently changing to 4
   * because someone moved in during Aban.
   */
  private async loadUnitInputs(
    scope: RequestScope,
    period: { startsAt: Date; endsAt: Date },
  ): Promise<GeneratableUnit[]> {
    const units = await this.prisma.unit.findMany({
      where: {
        ...this.tenantWhere(scope),
        archivedAt: null,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        label: true,
        kind: true,
        areaSqm: true,
        shareRatio: true,
        occupancies: {
          where: {
            periodStart: { lt: period.endsAt },
            OR: [{ periodEnd: null }, { periodEnd: { gt: period.startsAt } }],
          },
          select: { residentCount: true, kind: true },
        },
      },
      orderBy: { label: 'asc' },
    });

    return units.map((unit) => ({
      unitId: unit.id,
      label: unit.label,
      kind: unit.kind,
      areaSqm: unit.areaSqm,
      shareRatio: unit.shareRatio,
      // A VACANT occupancy asserts nobody lives there, so it must contribute
      // zero rather than its stored count.
      residentCount: unit.occupancies
        .filter((occupancy) => occupancy.kind !== 'VACANT')
        .reduce((count, occupancy) => count + occupancy.residentCount, 0),
    }));
  }

  private async loadPeriod(
    scope: RequestScope,
    periodId: string,
  ): Promise<FinancialPeriod> {
    const period = await this.prisma.financialPeriod.findFirst({
      where: { id: periodId, ...this.tenantWhere(scope) },
    });
    if (!period) throw new NotFoundException(ERRORS.periodNotFound);
    return period;
  }
}

/** Unit kinds the rule targets; an empty list means every unit. */
function filterUnitsForRule(
  rule: ChargeRule,
  units: readonly GeneratableUnit[],
): GeneratableUnit[] {
  if (rule.appliesToUnitKinds.length === 0) return [...units];

  const allowed = new Set<UnitKind>(rule.appliesToUnitKinds);
  return units.filter((unit) => allowed.has(unit.kind));
}

function toRunResponse(run: {
  id: string;
  financialPeriodId: string;
  unitsEvaluated: number;
  chargesCreated: number;
  invoicesIssued: number;
  totalAmount: Prisma.Decimal;
  startedAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
}): ChargeRunResponse {
  return {
    id: run.id,
    financialPeriodId: run.financialPeriodId,
    unitsEvaluated: run.unitsEvaluated,
    chargesCreated: run.chargesCreated,
    invoicesIssued: run.invoicesIssued,
    totalAmount: toAmount(run.totalAmount),
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    failureReason: run.failureReason,
  };
}

/**
 * Turns "this month was already generated" into a Persian 409 (§51).
 *
 * Two different constraints can be the one that fires, and which one wins is not
 * predictable under concurrency — the same lesson this codebase has now learned
 * in management terms, ownership and periods. `charge_runs_buildingId_...` is
 * hit when a second run starts; `charges_one_per_rule_unit_period` when a
 * charge slips through another path. Both mean the same thing to the manager.
 */
function translateGenerationConflict(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    return new ConflictException(ERRORS.chargeAlreadyGenerated);
  }
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    (error.message.includes('charge_runs') ||
      error.message.includes('charges_one_per_rule_unit_period'))
  ) {
    return new ConflictException(ERRORS.chargeAlreadyGenerated);
  }
  return error;
}
