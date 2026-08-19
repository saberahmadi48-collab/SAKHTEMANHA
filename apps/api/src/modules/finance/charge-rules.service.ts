import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ChargeRule } from '@prisma/client';
import type { RequestScope } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { TenantScopedRepository } from '../../core/database/tenant-scoped.repository';
import {
  ChargeConfigurationError,
  calculateCharges,
} from '../../core/finance/charge-calculator';
import type {
  ArchiveChargeRuleDto,
  ChargeRuleResponse,
  CreateChargeRuleDto,
  ReviseChargeRuleDto,
} from './dto/charge-rule.dto';

/**
 * Charge rules — the building's stored, effective-dated formulas (BM-03 §19/§52).
 *
 * THE CENTRAL RULE OF THIS SERVICE: an active rule is never edited in place.
 *
 * That is not tidiness, it is the mechanism behind §52. A charge stores the rule
 * version that produced it, and a snapshot of the inputs. If someone could edit
 * the amount on a live rule, then six months later the row a historical charge
 * points at would claim a figure that never produced that charge — the audit
 * trail would be lying while looking perfectly consistent. So `revise` writes
 * version + 1 and closes the old version's effectivity at the same instant the
 * new one opens: no gap, no overlap, and the old row survives untouched.
 *
 * A rule is validated by RUNNING it, not by inspecting it. `create` and `revise`
 * both feed the configuration through the real calculation engine against a
 * probe unit, so a rule that saves is a rule that can actually execute. A typo
 * in `totalCost` fails at configuration time in front of the manager, rather
 * than at 2am when the monthly generation runs.
 */
@Injectable()
export class ChargeRulesService extends TenantScopedRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async list(
    scope: RequestScope,
    options: { includeSuperseded?: boolean } = {},
  ): Promise<ChargeRuleResponse[]> {
    const rows = await this.prisma.chargeRule.findMany({
      where: {
        ...this.tenantWhere(scope),
        ...(options.includeSuperseded
          ? {}
          : { status: { in: ['DRAFT', 'ACTIVE'] } }),
      },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }, { version: 'desc' }],
    });

    return rows.map(toResponse);
  }

  async findOne(scope: RequestScope, ruleId: string): Promise<ChargeRuleResponse> {
    return toResponse(await this.load(scope, ruleId));
  }

  /**
   * Creates the first version of a rule, ACTIVE from `effectiveFrom`.
   *
   * Rejects a second ACTIVE rule with the same name: two live rules of the same
   * name would both match during generation and bill the unit twice for the
   * thing the resident thinks of as one line on their invoice.
   */
  async create(
    scope: RequestScope,
    dto: CreateChargeRuleDto,
  ): Promise<ChargeRuleResponse> {
    const effectiveFrom = new Date(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;

    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new ConflictException(ERRORS.chargeRuleEffectivityOrder);
    }

    this.assertRunnable(dto.calculationMethod, dto.configuration);

    const clash = await this.prisma.chargeRule.findFirst({
      where: {
        ...this.tenantWhere(scope),
        name: dto.name,
        status: { in: ['DRAFT', 'ACTIVE'] },
      },
    });
    if (clash) throw new ConflictException(ERRORS.chargeRuleAlreadyActive);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const rule = await tx.chargeRule.create({
          data: {
            buildingId: scope.buildingId!,
            name: dto.name,
            description: dto.description ?? null,
            chargeType: dto.chargeType ?? 'REGULAR',
            calculationMethod: dto.calculationMethod,
            version: 1,
            effectiveFrom,
            effectiveTo,
            priority: dto.priority ?? 100,
            status: 'ACTIVE',
            configuration: dto.configuration as Prisma.InputJsonValue,
            appliesToUnitKinds: dto.appliesToUnitKinds ?? [],
          },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'finance.chargeRule.created',
          resourceType: 'ChargeRule',
          resourceId: rule.id,
          after: {
            name: rule.name,
            version: rule.version,
            method: rule.calculationMethod,
            configuration: dto.configuration,
          },
        });

        return rule;
      });

      return toResponse(created);
    } catch (error) {
      throw translateRuleConflict(error);
    }
  }

  /**
   * Supersedes an active rule with a new version (§52).
   *
   * The two writes — closing the old version and opening the new one — are in
   * ONE transaction on purpose. Split apart, a failure between them leaves the
   * building either with no active rule (nobody gets charged next month) or with
   * two (everybody gets charged twice).
   */
  async revise(
    scope: RequestScope,
    ruleId: string,
    dto: ReviseChargeRuleDto,
  ): Promise<ChargeRuleResponse> {
    const current = await this.load(scope, ruleId);

    if (current.status !== 'ACTIVE') {
      throw new ConflictException(ERRORS.chargeRuleNotActive);
    }

    const effectiveFrom = new Date(dto.effectiveFrom);
    if (effectiveFrom <= current.effectiveFrom) {
      throw new ConflictException(ERRORS.chargeRuleEffectivityOrder);
    }

    this.assertRunnable(current.calculationMethod, dto.configuration);

    try {
      const next = await this.prisma.$transaction(async (tx) => {
        await tx.chargeRule.update({
          where: { id: current.id },
          data: { status: 'SUPERSEDED', effectiveTo: effectiveFrom },
        });

        const created = await tx.chargeRule.create({
          data: {
            buildingId: current.buildingId,
            name: current.name,
            description: dto.description ?? current.description,
            chargeType: current.chargeType,
            calculationMethod: current.calculationMethod,
            version: current.version + 1,
            effectiveFrom,
            effectiveTo: null,
            priority: current.priority,
            status: 'ACTIVE',
            configuration: dto.configuration as Prisma.InputJsonValue,
            appliesToUnitKinds:
              dto.appliesToUnitKinds ?? current.appliesToUnitKinds,
          },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'finance.chargeRule.revised',
          resourceType: 'ChargeRule',
          resourceId: created.id,
          before: {
            version: current.version,
            configuration: current.configuration,
          },
          after: {
            version: created.version,
            configuration: dto.configuration,
            supersededRuleId: current.id,
          },
        });

        return created;
      });

      return toResponse(next);
    } catch (error) {
      throw translateRuleConflict(error);
    }
  }

  /**
   * Retires a rule by closing its effectivity (R2 — nothing is hard-deleted).
   *
   * Past charges keep pointing at it; it simply stops matching future runs.
   */
  async archive(
    scope: RequestScope,
    ruleId: string,
    dto: ArchiveChargeRuleDto,
  ): Promise<ChargeRuleResponse> {
    const rule = await this.load(scope, ruleId);

    if (rule.status === 'ARCHIVED') {
      throw new ConflictException(ERRORS.chargeRuleNotActive);
    }

    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : new Date();
    if (effectiveTo <= rule.effectiveFrom) {
      throw new ConflictException(ERRORS.chargeRuleEffectivityOrder);
    }

    const archived = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.chargeRule.update({
        where: { id: rule.id },
        data: { status: 'ARCHIVED', effectiveTo },
      });

      await this.audit.logInTransaction(tx, scope, {
        action: 'finance.chargeRule.archived',
        resourceType: 'ChargeRule',
        resourceId: rule.id,
        before: { status: rule.status },
        after: { status: 'ARCHIVED', effectiveTo: effectiveTo.toISOString() },
      });

      return updated;
    });

    return toResponse(archived);
  }

  /**
   * The rules in force across a period, in execution order.
   *
   * Effectivity is compared against the PERIOD's window, not against "now": a
   * run for Mehr executed in Aban must use the rules that were in force during
   * Mehr. Using the current instant would quietly bill last month at this
   * month's rate.
   *
   * The overlap test is half-open on both sides — `effectiveFrom < periodEnd`
   * and `effectiveTo > periodStart` — so a rule that ends exactly when the
   * period begins does not match.
   */
  async rulesInForce(
    scope: RequestScope,
    period: { startsAt: Date; endsAt: Date },
  ): Promise<ChargeRule[]> {
    return this.prisma.chargeRule.findMany({
      where: {
        ...this.tenantWhere(scope),
        status: 'ACTIVE',
        effectiveFrom: { lt: period.endsAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: period.startsAt } }],
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Proves the configuration actually runs, by running it.
   *
   * A probe unit with an area and a resident count exercises every branch the
   * real generation will take, so a missing or non-numeric key surfaces here as
   * a Persian 409 instead of aborting the monthly run later.
   *
   * CONSUMPTION_BASED and CUSTOM throw from the engine by design (§17) — those
   * are rejected at configuration time rather than being saved as rules that can
   * never execute.
   */
  private assertRunnable(
    calculationMethod: ChargeRule['calculationMethod'],
    configuration: Record<string, unknown>,
  ): void {
    try {
      calculateCharges(
        {
          id: 'probe',
          name: 'probe',
          version: 1,
          calculationMethod,
          configuration,
        },
        [
          {
            unitId: 'probe-unit',
            label: 'probe',
            areaSqm: new Prisma.Decimal(100),
            shareRatio: null,
            residentCount: 1,
          },
        ],
      );
    } catch (error) {
      if (error instanceof ChargeConfigurationError) {
        throw new ConflictException(
          ERRORS.chargeRuleConfigInvalid(calculationMethod),
        );
      }
      throw error;
    }
  }

  private async load(scope: RequestScope, ruleId: string): Promise<ChargeRule> {
    const rule = await this.prisma.chargeRule.findFirst({
      where: { id: ruleId, ...this.tenantWhere(scope) },
    });
    if (!rule) throw new NotFoundException(ERRORS.chargeRuleNotFound);
    return rule;
  }
}

function toResponse(rule: ChargeRule): ChargeRuleResponse {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    chargeType: rule.chargeType,
    calculationMethod: rule.calculationMethod,
    version: rule.version,
    effectiveFrom: rule.effectiveFrom.toISOString(),
    effectiveTo: rule.effectiveTo?.toISOString() ?? null,
    priority: rule.priority,
    status: rule.status,
    configuration: (rule.configuration ?? {}) as Record<string, unknown>,
    appliesToUnitKinds: rule.appliesToUnitKinds,
    createdAt: rule.createdAt.toISOString(),
  };
}

/**
 * Translates the (buildingId, name, version) unique into a Persian 409.
 *
 * Same lesson as management terms, ownership and periods before it: under a
 * double-click two revisions race for version + 1, and the loser must get a
 * conflict rather than a raw 500. Matched on the structured `P2002` code, not on
 * message text, because the wording changes between driver versions.
 */
function translateRuleConflict(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    return new ConflictException(ERRORS.chargeRuleNameTaken);
  }
  return error;
}
