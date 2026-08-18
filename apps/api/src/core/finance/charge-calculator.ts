import { Prisma, type ChargeCalculationMethod } from '@prisma/client';

import { apportion, round, sum, toDecimal } from './money';

/**
 * The charge calculation engine (BM-03 §12-§18).
 *
 * DELIBERATELY A PURE FUNCTION over plain inputs — no Prisma, no request scope,
 * no I/O. Two reasons, both load-bearing:
 *
 *  1. §12 says the formula is CONFIGURATION, not logic buried in a controller.
 *     A pure engine that takes a rule and a unit snapshot is the executable form
 *     of that sentence.
 *
 *  2. §52 requires historical charges to be reproducible. Reproducing a figure
 *     from six months ago means re-running this function on the SNAPSHOT that
 *     was stored with the charge — which is only possible if it depends on
 *     nothing but its arguments.
 *
 * Every result carries the inputs and intermediate components that produced it,
 * and those are what `ChargeCalculationSnapshot` persists (§18).
 */

/** One unit as the engine sees it, resolved from BM-01/BM-02 master data. */
export interface UnitChargeInput {
  unitId: string;
  label: string;
  /** From Unit.areaSqm. Null when the building has not recorded areas. */
  areaSqm: Prisma.Decimal | null;
  /** From Unit.shareRatio — an explicit common-expense share if configured. */
  shareRatio: Prisma.Decimal | null;
  /**
   * Headcount from the occupancy in force AT THE PERIOD, not today (§16).
   * Passing "current" headcount would let a resident moving in next month
   * silently change last month's invoice.
   */
  residentCount: number;
}

/** The rule as stored, narrowed to what the engine needs. */
export interface ChargeRuleInput {
  id: string;
  name: string;
  version: number;
  calculationMethod: ChargeCalculationMethod;
  configuration: Record<string, unknown>;
}

export interface CalculatedCharge {
  unitId: string;
  baseAmount: Prisma.Decimal;
  calculatedAmount: Prisma.Decimal;
  /** Persisted verbatim into the snapshot — the evidence for §18. */
  inputs: Record<string, unknown>;
  values: Record<string, unknown>;
}

/** Raised for a rule whose configuration does not match its declared method. */
export class ChargeConfigurationError extends Error {
  constructor(readonly method: ChargeCalculationMethod, message: string) {
    super(message);
    this.name = 'ChargeConfigurationError';
  }
}

/**
 * Calculates one charge per eligible unit.
 *
 * WHY IT TAKES ALL UNITS AT ONCE rather than being called per unit: the
 * area-based methods are inherently a SPLIT of a building-wide cost. A unit's
 * share depends on the total eligible area, so per-unit calls would each need
 * the whole set anyway — and would risk each call seeing a different total.
 * Taking the set once also lets `apportion` guarantee the parts sum EXACTLY to
 * the total (§14), with no lost Rial.
 */
export function calculateCharges(
  rule: ChargeRuleInput,
  units: readonly UnitChargeInput[],
): CalculatedCharge[] {
  switch (rule.calculationMethod) {
    case 'FIXED':
      return fixed(rule, units);
    case 'AREA_BASED':
      return areaBased(rule, units);
    case 'FIXED_PLUS_AREA':
      return fixedPlusArea(rule, units);
    case 'PER_PERSON':
      return perPerson(rule, units);
    case 'CONSUMPTION_BASED':
      // §17 defines the interface only; meters and readings are a later phase.
      // Failing loudly beats inventing a number for someone's invoice.
      throw new ChargeConfigurationError(
        rule.calculationMethod,
        'CONSUMPTION_BASED requires meter readings, which BM-03 does not implement',
      );
    case 'CUSTOM':
      throw new ChargeConfigurationError(
        rule.calculationMethod,
        'CUSTOM formula evaluation is out of scope for BM-03',
      );
    default: {
      // Exhaustiveness: adding a method to the enum without handling it here is
      // a compile error rather than a silent zero charge.
      const never: never = rule.calculationMethod;
      throw new ChargeConfigurationError(
        never,
        `Unhandled calculation method: ${String(never)}`,
      );
    }
  }
}

/** §13 — every unit pays the same amount. */
function fixed(
  rule: ChargeRuleInput,
  units: readonly UnitChargeInput[],
): CalculatedCharge[] {
  const amount = requirePositiveAmount(rule, 'amount');

  return units.map((unit) => ({
    unitId: unit.unitId,
    baseAmount: amount,
    calculatedAmount: amount,
    inputs: { method: 'FIXED', amount: amount.toString(), unitLabel: unit.label },
    values: { fixedComponent: amount.toString() },
  }));
}

/**
 * §14 — Charge = Total Cost x Unit Area / Eligible Area.
 *
 * Units with no recorded area are EXCLUDED from the split rather than treated as
 * zero: including them at zero would still divide the cost among the others,
 * which is the same outcome, but silently. Excluding them explicitly means the
 * caller can see and report the skipped units.
 */
function areaBased(
  rule: ChargeRuleInput,
  units: readonly UnitChargeInput[],
): CalculatedCharge[] {
  const totalCost = requirePositiveAmount(rule, 'totalCost');
  const eligible = units.filter((unit) => hasArea(unit));

  if (eligible.length === 0) {
    throw new ChargeConfigurationError(
      rule.calculationMethod,
      'No unit has a recorded area, so an area-based charge cannot be split',
    );
  }

  const weights = eligible.map((unit) => unit.areaSqm as Prisma.Decimal);
  const eligibleArea = sum(weights);
  const parts = apportion(totalCost, weights);

  // Zipped rather than indexed: `apportion` returns one part per weight in the
  // same order, and pairing them here keeps that contract visible (and satisfies
  // noUncheckedIndexedAccess without assertions).
  return eligible.map((unit, index) => {
    const area = weights[index] ?? new Prisma.Decimal(0);
    const share = parts[index] ?? new Prisma.Decimal(0);

    return {
      unitId: unit.unitId,
      baseAmount: totalCost,
      calculatedAmount: share,
      inputs: {
        method: 'AREA_BASED',
        totalCost: totalCost.toString(),
        unitArea: area.toString(),
        eligibleArea: eligibleArea.toString(),
        unitLabel: unit.label,
      },
      values: { areaComponent: share.toString() },
    };
  });
}

/** §15 — a flat component every unit pays, plus an area-proportional share. */
function fixedPlusArea(
  rule: ChargeRuleInput,
  units: readonly UnitChargeInput[],
): CalculatedCharge[] {
  const fixedAmount = requirePositiveAmount(rule, 'fixedAmount');
  const totalAreaCost = requirePositiveAmount(rule, 'totalAreaCost');
  const eligible = units.filter((unit) => hasArea(unit));

  if (eligible.length === 0) {
    throw new ChargeConfigurationError(
      rule.calculationMethod,
      'No unit has a recorded area, so the area component cannot be split',
    );
  }

  const weights = eligible.map((unit) => unit.areaSqm as Prisma.Decimal);
  const eligibleArea = sum(weights);
  const areaParts = apportion(totalAreaCost, weights);

  return eligible.map((unit, index) => {
    const area = weights[index] ?? new Prisma.Decimal(0);
    const areaComponent = areaParts[index] ?? new Prisma.Decimal(0);
    const total = round(fixedAmount.plus(areaComponent));

    return {
      unitId: unit.unitId,
      // Base is the whole building-wide input, so the snapshot shows what was
      // being divided rather than only this unit's slice.
      baseAmount: round(fixedAmount.plus(totalAreaCost)),
      calculatedAmount: total,
      inputs: {
        method: 'FIXED_PLUS_AREA',
        fixedAmount: fixedAmount.toString(),
        totalAreaCost: totalAreaCost.toString(),
        unitArea: area.toString(),
        eligibleArea: eligibleArea.toString(),
        unitLabel: unit.label,
      },
      values: {
        fixedComponent: fixedAmount.toString(),
        areaComponent: areaComponent.toString(),
        total: total.toString(),
      },
    };
  });
}

/**
 * §16 — Charge = Rate x Eligible Resident Count.
 *
 * The headcount comes from the caller's PERIOD SNAPSHOT, never from "who lives
 * here now". §16 is explicit: a resident moving in later must not change a
 * charge that was already calculated.
 */
function perPerson(
  rule: ChargeRuleInput,
  units: readonly UnitChargeInput[],
): CalculatedCharge[] {
  const rate = requirePositiveAmount(rule, 'ratePerPerson');
  const eligible = units.filter((unit) => unit.residentCount > 0);

  if (eligible.length === 0) {
    throw new ChargeConfigurationError(
      rule.calculationMethod,
      'No unit has a recorded resident count for this period',
    );
  }

  return eligible.map((unit) => {
    const amount = round(rate.times(unit.residentCount));

    return {
      unitId: unit.unitId,
      baseAmount: rate,
      calculatedAmount: amount,
      inputs: {
        method: 'PER_PERSON',
        ratePerPerson: rate.toString(),
        residentCount: unit.residentCount,
        unitLabel: unit.label,
      },
      values: { total: amount.toString() },
    };
  });
}

function hasArea(unit: UnitChargeInput): boolean {
  return unit.areaSqm !== null && unit.areaSqm.greaterThan(0);
}

/**
 * Reads a required money field out of the rule's JSON configuration.
 *
 * Rejects zero and negatives as well as missing/NaN: a rule configured with a
 * negative amount would produce a charge that CREDITS the resident, which is
 * what the CREDIT charge type is for and must not happen by typo.
 */
function requirePositiveAmount(
  rule: ChargeRuleInput,
  key: string,
): Prisma.Decimal {
  const raw = rule.configuration?.[key];

  if (raw === undefined || raw === null || raw === '') {
    throw new ChargeConfigurationError(
      rule.calculationMethod,
      `Missing "${key}" in the configuration of rule "${rule.name}"`,
    );
  }

  let value: Prisma.Decimal;
  try {
    value = toDecimal(raw as string | number);
  } catch {
    throw new ChargeConfigurationError(
      rule.calculationMethod,
      `"${key}" is not a valid amount in rule "${rule.name}"`,
    );
  }

  if (!value.isFinite() || value.lessThanOrEqualTo(0)) {
    throw new ChargeConfigurationError(
      rule.calculationMethod,
      `"${key}" must be greater than zero in rule "${rule.name}"`,
    );
  }

  return value;
}
