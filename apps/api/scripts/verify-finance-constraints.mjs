/**
 * Proves the BM-03 finance constraints actually REJECT bad financial data.
 *
 * WHY THIS EXISTS: applying 003_finance_constraints.sql prints "ALTER"/"CREATE"
 * and that only proves the statements parsed. It does not prove a single rule
 * fires. These are the rules that silently corrupt money — duplicate monthly
 * charges, an editable ledger, a credit worth more than it was issued for — so
 * each one is exercised with a write that MUST be rejected.
 *
 * Sibling of verify-constraints.mjs (BM-01/BM-02 temporal rules); same shape,
 * same guarantee: a rule that is missing shows up as UNEXPECTEDLY ACCEPTED
 * rather than as a green run.
 *
 * Usage: node scripts/verify-finance-constraints.mjs   (needs the dev DB up)
 * Everything happens inside one transaction that is rolled back — the database
 * is untouched, so this is safe to re-run.
 */

import pg from 'pg';

const { Client } = pg;
const client = new Client({
  host: '127.0.0.1',
  port: 5432,
  user: 'bops',
  password: 'bops_dev_password',
  database: 'bops',
});

const results = [];

async function expectRejected(name, expectedConstraint, fn) {
  try {
    await fn();
    results.push({ name, ok: false, detail: 'UNEXPECTEDLY ACCEPTED' });
  } catch (error) {
    const matched =
      error.constraint === expectedConstraint ||
      error.message.includes(expectedConstraint);
    results.push({
      name,
      ok: matched,
      detail: matched
        ? `rejected by ${error.constraint ?? expectedConstraint}`
        : `rejected, but by the WRONG rule: ${error.constraint ?? error.message}`,
    });
  }
}

async function expectAccepted(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true, detail: 'accepted' });
  } catch (error) {
    results.push({ name, ok: false, detail: `WRONGLY REJECTED: ${error.message}` });
  }
}

await client.connect();

// Each expected failure aborts its transaction, so every attempt runs inside a
// SAVEPOINT — otherwise the first rejection would poison every later check.
async function attempt(sql, params) {
  await client.query('SAVEPOINT s');
  try {
    const r = await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT s');
    return r;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT s');
    throw error;
  }
}

try {
  await client.query('BEGIN');

  // --- Fixture: org / building / two units --------------------------------
  const org = (
    await client.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt")
       VALUES (gen_random_uuid(), 'آزمون مالی', 'fin-' || substr(md5(random()::text),1,8), now())
       RETURNING id`,
    )
  ).rows[0].id;

  const building = (
    await client.query(
      `INSERT INTO buildings (id, "organizationId", name, code, "updatedAt")
       VALUES (gen_random_uuid(), $1, 'ساختمان مالی', 'F1', now())
       RETURNING id`,
      [org],
    )
  ).rows[0].id;

  const unit = (
    await client.query(
      `INSERT INTO units (id, "buildingId", label, "areaSqm", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'F-1', 100, now()) RETURNING id`,
      [building],
    )
  ).rows[0].id;

  // --- Financial period ----------------------------------------------------
  const insertPeriod = (year, month, startsAt, endsAt, status = 'OPEN') =>
    attempt(
      `INSERT INTO financial_periods
         (id, "buildingId", year, month, "startsAt", "endsAt", status, "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())
       RETURNING id`,
      [building, year, month, startsAt, endsAt, status],
    );

  const period = (
    await insertPeriod(1404, 7, '2025-09-23T00:00:00Z', '2025-10-23T00:00:00Z')
  ).rows[0].id;
  results.push({ name: 'period: first period inserts', ok: true, detail: 'accepted' });

  await expectRejected(
    'period: month 13 is rejected',
    'financial_periods_month_range',
    () => insertPeriod(1404, 13, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'),
  );

  await expectRejected(
    'period: endsAt before startsAt is rejected',
    'financial_periods_period_order',
    () => insertPeriod(1404, 9, '2025-12-01T00:00:00Z', '2025-11-01T00:00:00Z'),
  );

  // The duplicate (year, month) is caught by the Prisma unique; this checks the
  // subtler case — a DIFFERENTLY numbered month whose range overlaps an existing
  // one, which only the EXCLUDE constraint can see.
  await expectRejected(
    'period: a different month overlapping an existing range is rejected',
    'financial_periods_no_overlap',
    () => insertPeriod(1404, 8, '2025-10-01T00:00:00Z', '2025-11-01T00:00:00Z'),
  );

  // Half-open [) — the next month starting exactly when this one ends is legal.
  await expectAccepted('period: adjacent month on the boundary is allowed', () =>
    insertPeriod(1404, 8, '2025-10-23T00:00:00Z', '2025-11-22T00:00:00Z'),
  );

  // --- Charge rule ---------------------------------------------------------
  const insertRule = (name, version, status, effFrom, effTo = null) =>
    attempt(
      `INSERT INTO charge_rules
         (id, "buildingId", name, "chargeType", "calculationMethod", version,
          "effectiveFrom", "effectiveTo", status, configuration, "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'REGULAR', 'FIXED', $3, $4, $5, $6,
               '{"amount": 2000000}'::jsonb, now())
       RETURNING id`,
      [building, name, version, effFrom, effTo, status],
    );

  const rule = (
    await insertRule('شارژ ماهانه', 1, 'ACTIVE', '2025-01-01T00:00:00Z')
  ).rows[0].id;
  results.push({ name: 'rule: first active rule inserts', ok: true, detail: 'accepted' });

  await expectRejected(
    'rule: effectiveTo before effectiveFrom is rejected',
    'charge_rules_effectivity_order',
    () =>
      insertRule('قانون بد', 1, 'DRAFT', '2025-06-01T00:00:00Z', '2025-01-01T00:00:00Z'),
  );

  // §52: two ACTIVE versions of one named formula would make "which rule produced
  // this invoice?" unanswerable.
  await expectRejected(
    'rule: a second ACTIVE version of the same rule name is rejected',
    'charge_rules_single_active_version',
    () => insertRule('شارژ ماهانه', 2, 'ACTIVE', '2025-06-01T00:00:00Z'),
  );

  // Superseding is the sanctioned path: the new version stays DRAFT until the
  // old one is closed, so history keeps exactly one active formula.
  await expectAccepted('rule: a DRAFT successor version is allowed', () =>
    insertRule('شارژ ماهانه', 2, 'DRAFT', '2025-06-01T00:00:00Z'),
  );

  // --- Charges: the anti-duplicate rule (§51) ------------------------------
  const insertCharge = (ruleId, amount = 2000000, status = 'ISSUED') =>
    attempt(
      `INSERT INTO charges
         (id, "buildingId", "unitId", "financialPeriodId", "chargeRuleId",
          "chargeType", "calculationMethod", "baseAmount", "calculatedAmount",
          status, "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'REGULAR', 'FIXED', $5, $5, $6, now())
       RETURNING id`,
      [building, unit, period, ruleId, amount, status],
    );

  await expectAccepted('charge: first monthly charge inserts', () => insertCharge(rule));

  // THE headline guarantee: running generation twice must not bill twice.
  await expectRejected(
    'charge: the same rule/unit/period a second time is rejected (§51)',
    'charges_one_per_rule_unit_period',
    () => insertCharge(rule),
  );

  await expectRejected(
    'charge: a negative amount is rejected',
    'charges_amounts_non_negative',
    () =>
      attempt(
        `INSERT INTO charges
           (id, "buildingId", "unitId", "financialPeriodId",
            "chargeType", "calculationMethod", "baseAmount", "calculatedAmount",
            status, "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, 'EXTRAORDINARY', 'FIXED', -1, -1,
                 'DRAFT', now())`,
        [building, unit, period],
      ),
  );

  // --- Ledger: append-only + idempotency -----------------------------------
  const insertEntry = (direction, amount, idem = null, refType = 'CHARGE') =>
    attempt(
      `INSERT INTO ledger_entries
         (id, "buildingId", "unitId", "financialPeriodId", direction, amount,
          "referenceType", "idempotencyKey", "occurredAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now())
       RETURNING id`,
      [building, unit, period, direction, amount, refType, idem],
    );

  const entry = (await insertEntry('DEBIT', 2000000)).rows[0].id;
  results.push({ name: 'ledger: first entry inserts', ok: true, detail: 'accepted' });

  await expectRejected(
    'ledger: a zero-amount entry is rejected',
    'ledger_entries_amount_positive',
    () => insertEntry('CREDIT', 0),
  );

  // §34 — a provider retrying the same callback must not settle twice.
  await expectAccepted('ledger: an entry with an idempotency key inserts', () =>
    insertEntry('CREDIT', 500000, 'callback-abc-123', 'PAYMENT'),
  );

  await expectRejected(
    'ledger: replaying the same idempotency key is rejected (§34)',
    'ledger_entries_buildingId_idempotencyKey_key',
    () => insertEntry('CREDIT', 500000, 'callback-abc-123', 'PAYMENT'),
  );

  // §7/§46 — the ledger is append-only in the DATABASE, not merely by convention.
  await expectRejected(
    'ledger: UPDATE on a posted entry is rejected (append-only)',
    'append-only',
    () => attempt(`UPDATE ledger_entries SET amount = 1 WHERE id = $1`, [entry]),
  );

  await expectRejected(
    'ledger: DELETE of a posted entry is rejected (append-only)',
    'append-only',
    () => attempt(`DELETE FROM ledger_entries WHERE id = $1`, [entry]),
  );

  // --- Credits (§26/§27) ---------------------------------------------------
  await expectAccepted('credit: an overpayment credit inserts', () =>
    attempt(
      `INSERT INTO unit_credits
         (id, "buildingId", "unitId", amount, "remainingAmount", status, "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 500000, 500000, 'AVAILABLE', now())`,
      [building, unit],
    ),
  );

  await expectRejected(
    'credit: remaining greater than the original amount is rejected',
    'unit_credits_remaining_within_bounds',
    () =>
      attempt(
        `INSERT INTO unit_credits
           (id, "buildingId", "unitId", amount, "remainingAmount", status, "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 500000, 900000, 'AVAILABLE', now())`,
        [building, unit],
      ),
  );

  // --- Invoice numbering (§23) --------------------------------------------
  // Allocation must be monotonic; the same call twice must never return the same
  // number, which is what makes concurrent issuance safe.
  const n1 = (
    await attempt(`SELECT next_invoice_number($1, 1404, 7) AS n`, [building])
  ).rows[0].n;
  const n2 = (
    await attempt(`SELECT next_invoice_number($1, 1404, 7) AS n`, [building])
  ).rows[0].n;
  results.push({
    name: 'invoice numbering: consecutive allocations never repeat',
    ok: n1 === 1 && n2 === 2,
    detail: n1 === 1 && n2 === 2 ? `allocated ${n1} then ${n2}` : `got ${n1} then ${n2}`,
  });
} finally {
  // Nothing is kept: this is a verification run, not a seed.
  await client.query('ROLLBACK');
  await client.end();
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
