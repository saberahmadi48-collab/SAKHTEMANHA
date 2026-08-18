/**
 * Runs the REAL charge calculator against real Prisma.Decimal values.
 *
 * WHY THIS EXISTS: `tsc` proves the engine compiles. It does not prove that
 * 1,000,000 split across three units adds back up to 1,000,000, and that is the
 * property residents actually notice. This executes the compiled engine from
 * dist/ so the arithmetic is checked, not assumed.
 *
 * Prerequisite: `nest build` (or scripts/nest-build.cmd) so dist/ is current.
 * Usage: node scripts/verify-calculator.mjs
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { calculateCharges } = require('../dist/core/finance/charge-calculator.js');
const { apportion, toAmount } = require('../dist/core/finance/money.js');
const { Prisma } = require('@prisma/client');

const D = (v) => new Prisma.Decimal(v);
const results = [];

function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail });
}

const units = [
  { unitId: 'u1', label: '1', areaSqm: D(80), shareRatio: null, residentCount: 2 },
  { unitId: 'u2', label: '2', areaSqm: D(120), shareRatio: null, residentCount: 4 },
  { unitId: 'u3', label: '3', areaSqm: D(65), shareRatio: null, residentCount: 1 },
];

// --- §13 FIXED -------------------------------------------------------------
{
  const out = calculateCharges(
    {
      id: 'r1',
      name: 'شارژ ثابت',
      version: 1,
      calculationMethod: 'FIXED',
      configuration: { amount: 2000000 },
    },
    units,
  );
  check(
    'FIXED: every unit is charged the same amount',
    out.length === 3 && out.every((c) => toAmount(c.calculatedAmount) === 2000000),
    out.map((c) => toAmount(c.calculatedAmount)).join(', '),
  );
}

// --- §14 AREA_BASED --------------------------------------------------------
{
  const total = 5000000;
  const out = calculateCharges(
    {
      id: 'r2',
      name: 'شارژ مساحتی',
      version: 1,
      calculationMethod: 'AREA_BASED',
      configuration: { totalCost: total },
    },
    units,
  );
  const sum = out.reduce((a, c) => a + toAmount(c.calculatedAmount), 0);
  check(
    'AREA_BASED: shares sum EXACTLY to the total cost',
    Math.abs(sum - total) < 0.005,
    `sum=${sum} target=${total} parts=${out.map((c) => toAmount(c.calculatedAmount)).join(', ')}`,
  );
  // Bigger area must pay more — the ordering property residents check first.
  const byUnit = Object.fromEntries(out.map((c) => [c.unitId, toAmount(c.calculatedAmount)]));
  check(
    'AREA_BASED: the largest unit pays the most',
    byUnit.u2 > byUnit.u1 && byUnit.u1 > byUnit.u3,
    `u2=${byUnit.u2} u1=${byUnit.u1} u3=${byUnit.u3}`,
  );
  check(
    'AREA_BASED: the snapshot records eligibleArea for reproducibility (§18)',
    out[0].inputs.eligibleArea === '265',
    String(out[0].inputs.eligibleArea),
  );
}

// The classic rounding trap: three EQUAL units, an amount that does not divide.
{
  const equal = [
    { unitId: 'a', label: 'A', areaSqm: D(100), shareRatio: null, residentCount: 1 },
    { unitId: 'b', label: 'B', areaSqm: D(100), shareRatio: null, residentCount: 1 },
    { unitId: 'c', label: 'C', areaSqm: D(100), shareRatio: null, residentCount: 1 },
  ];
  const out = calculateCharges(
    {
      id: 'r3',
      name: 'تقسیم سه‌گانه',
      version: 1,
      calculationMethod: 'AREA_BASED',
      configuration: { totalCost: 1000000 },
    },
    equal,
  );
  const sum = out.reduce((a, c) => a + toAmount(c.calculatedAmount), 0);
  check(
    'AREA_BASED: 1,000,000 across three equal units loses no Rial',
    Math.abs(sum - 1000000) < 0.005,
    `parts=${out.map((c) => toAmount(c.calculatedAmount)).join(', ')} sum=${sum}`,
  );
}

// --- §15 FIXED_PLUS_AREA ---------------------------------------------------
{
  const out = calculateCharges(
    {
      id: 'r4',
      name: 'ثابت به‌علاوه مساحت',
      version: 1,
      calculationMethod: 'FIXED_PLUS_AREA',
      configuration: { fixedAmount: 1000000, totalAreaCost: 3000000 },
    },
    units,
  );
  const sum = out.reduce((a, c) => a + toAmount(c.calculatedAmount), 0);
  // Each unit pays the fixed part, plus its slice of the area cost.
  const expected = 1000000 * 3 + 3000000;
  check(
    'FIXED_PLUS_AREA: total collected = fixed x units + area cost',
    Math.abs(sum - expected) < 0.005,
    `sum=${sum} expected=${expected}`,
  );
  check(
    'FIXED_PLUS_AREA: components are recorded separately in the snapshot',
    out[0].values.fixedComponent === '1000000' && 'areaComponent' in out[0].values,
    JSON.stringify(out[0].values),
  );
}

// --- §16 PER_PERSON --------------------------------------------------------
{
  const out = calculateCharges(
    {
      id: 'r5',
      name: 'سرانه',
      version: 1,
      calculationMethod: 'PER_PERSON',
      configuration: { ratePerPerson: 500000 },
    },
    units,
  );
  const byUnit = Object.fromEntries(out.map((c) => [c.unitId, toAmount(c.calculatedAmount)]));
  check(
    'PER_PERSON: charge = rate x resident count',
    byUnit.u1 === 1000000 && byUnit.u2 === 2000000 && byUnit.u3 === 500000,
    JSON.stringify(byUnit),
  );
}

// --- Guard rails -----------------------------------------------------------
function expectThrow(name, fn, mustInclude) {
  try {
    fn();
    check(name, false, 'UNEXPECTEDLY SUCCEEDED');
  } catch (error) {
    check(name, String(error.message).includes(mustInclude), error.message);
  }
}

expectThrow(
  'a negative configured amount is rejected',
  () =>
    calculateCharges(
      { id: 'x', name: 'بد', version: 1, calculationMethod: 'FIXED', configuration: { amount: -5 } },
      units,
    ),
  'greater than zero',
);

expectThrow(
  'a missing configuration key is rejected',
  () =>
    calculateCharges(
      { id: 'x', name: 'بد', version: 1, calculationMethod: 'FIXED', configuration: {} },
      units,
    ),
  'Missing',
);

expectThrow(
  'CONSUMPTION_BASED fails loudly rather than inventing a number (§17)',
  () =>
    calculateCharges(
      { id: 'x', name: 'مصرفی', version: 1, calculationMethod: 'CONSUMPTION_BASED', configuration: {} },
      units,
    ),
  'meter readings',
);

expectThrow(
  'area-based with no recorded areas is rejected, not silently zero',
  () =>
    calculateCharges(
      { id: 'x', name: 'م', version: 1, calculationMethod: 'AREA_BASED', configuration: { totalCost: 100 } },
      [{ unitId: 'n', label: 'N', areaSqm: null, shareRatio: null, residentCount: 1 }],
    ),
  'recorded area',
);

// --- §52 reproducibility ---------------------------------------------------
{
  const rule = {
    id: 'r6',
    name: 'تکرارپذیری',
    version: 1,
    calculationMethod: 'AREA_BASED',
    configuration: { totalCost: 7777777 },
  };
  const a = calculateCharges(rule, units).map((c) => toAmount(c.calculatedAmount));
  const b = calculateCharges(rule, units).map((c) => toAmount(c.calculatedAmount));
  check(
    'same rule + same inputs produce identical amounts (§52)',
    JSON.stringify(a) === JSON.stringify(b),
    `${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
  );
}

// --- apportion directly ----------------------------------------------------
{
  const parts = apportion(D(100), [D(1), D(1), D(1)]);
  const sum = parts.reduce((a, p) => a.plus(p), D(0));
  check(
    'apportion: 100 across three equal weights sums to exactly 100',
    sum.equals(D(100)),
    parts.map((p) => p.toString()).join(', '),
  );
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
