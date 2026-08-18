import { Prisma } from '@prisma/client';

/**
 * Money arithmetic for the finance domain (BM-03).
 *
 * WHY THIS FILE EXISTS AT ALL: JavaScript numbers are IEEE-754 doubles, and
 * `0.1 + 0.2 !== 0.3`. On a ledger those errors accumulate until the books stop
 * balancing, and the failure is silent — nobody notices until a resident
 * disputes a figure that is off by a Rial. Every amount in BM-03 is therefore a
 * `Prisma.Decimal` (Postgres `numeric`) from the moment it enters the system
 * until the moment it is serialised for JSON.
 *
 * THE RULE: never let a raw `number` touch an amount. Convert at the edges —
 * `toDecimal` on the way in, `toAmount` on the way out — and do all arithmetic
 * in between with the helpers here.
 */

/** The scale every stored amount uses. Matches @db.Decimal(18, 2) in the schema. */
export const MONEY_SCALE = 2;

/**
 * Converts an untrusted input into an exact Decimal.
 *
 * Accepts a string in preference to a number: a client that sends
 * `"12500000.55"` keeps full precision, whereas a JSON number has already been
 * through a double by the time we see it.
 */
export function toDecimal(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/**
 * Serialises a Decimal for an HTTP response.
 *
 * THIS IS NOT COSMETIC. `Prisma.Decimal` serialises through `JSON.stringify` as
 * `{"s":1,"e":6,"d":[...]}` — the client then reads `NaN`. Every DTO mapper in
 * the finance module must run amounts through here; the same bug already bit
 * `sharePercent` in BM-01 ownership.
 */
export function toAmount(value: Prisma.Decimal | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value.toFixed(MONEY_SCALE));
}

/** Rounds to the stored scale using half-up — the convention for currency. */
export function round(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

export function sum(values: readonly Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce(
    (total, value) => total.plus(value),
    new Prisma.Decimal(0),
  );
}

export function isPositive(value: Prisma.Decimal): boolean {
  return value.greaterThan(0);
}

export function isZero(value: Prisma.Decimal): boolean {
  return value.isZero();
}

/**
 * Apportions a total across weights so the parts add up to the total EXACTLY.
 *
 * THE PROBLEM THIS SOLVES: splitting 1,000,000 across three equal units gives
 * 333,333.33 each, which sums to 999,999.99. The lost Rial has to go somewhere,
 * and "somewhere" must be deterministic — otherwise re-running generation
 * produces different invoices and §52 reproducibility is broken.
 *
 * THE RULE HERE: every share is rounded down to the stored scale, and the entire
 * remainder is given to the LARGEST weight (ties broken by the caller's input
 * order, which is itself ordered by unit label). The largest contributor
 * absorbing the rounding dust is both conventional in Iranian building
 * accounting and stable across runs.
 *
 * Returns parts in the same order as `weights`.
 */
export function apportion(
  total: Prisma.Decimal,
  weights: readonly Prisma.Decimal[],
): Prisma.Decimal[] {
  const weightTotal = sum(weights);

  // No meaningful weights: nothing can be apportioned. Returning zeros rather
  // than dividing by zero keeps the caller's error handling in one place.
  if (weightTotal.isZero() || weights.length === 0) {
    return weights.map(() => new Prisma.Decimal(0));
  }

  const parts = weights.map((weight) =>
    total.times(weight).dividedBy(weightTotal).toDecimalPlaces(
      MONEY_SCALE,
      Prisma.Decimal.ROUND_DOWN,
    ),
  );

  const remainder = total.minus(sum(parts));
  if (remainder.isZero()) return parts;

  // Index access is narrowed explicitly because tsconfig enables
  // noUncheckedIndexedAccess — the loop bounds already guarantee presence, but
  // the compiler is right to insist we say so rather than assert it away.
  let largestIndex = 0;
  for (let i = 1; i < weights.length; i += 1) {
    const candidate = weights[i];
    const incumbent = weights[largestIndex];
    if (candidate && incumbent && candidate.greaterThan(incumbent)) {
      largestIndex = i;
    }
  }

  const largestPart = parts[largestIndex];
  if (largestPart) parts[largestIndex] = largestPart.plus(remainder);

  return parts;
}
