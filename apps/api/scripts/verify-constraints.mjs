/**
 * Proves the database-level temporal integrity rules actually REJECT bad data.
 *
 * WHY THIS EXISTS: `psql -f 001_temporal_exclusion.sql` printing "ALTER" only
 * proves the statement parsed. It does not prove the constraint fires. These
 * rules (no two owners of the same unit at once, no two governing terms at once)
 * are the ones that silently corrupt a ledger when they are missing, so each one
 * is exercised with a write that MUST fail.
 *
 * Every check is "expect this INSERT to be rejected". A check that passes
 * because the constraint is absent would show up as UNEXPECTEDLY ACCEPTED.
 *
 * Usage: node scripts/verify-constraints.mjs   (needs the dev DB running)
 * Cleans up after itself; safe to re-run.
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

/** Runs `fn`, expecting Postgres to reject it. Records pass/fail either way. */
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

/** Runs `fn`, expecting it to succeed — guards against over-strict constraints. */
async function expectAccepted(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true, detail: 'accepted' });
  } catch (error) {
    results.push({ name, ok: false, detail: `WRONGLY REJECTED: ${error.message}` });
  }
}

await client.connect();

// Each failed statement aborts its transaction, so every check runs inside a
// SAVEPOINT — otherwise the first expected failure would poison the rest.
async function attempt(sql, params) {
  await client.query('SAVEPOINT s');
  try {
    await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT s');
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT s');
    throw error;
  }
}

try {
  await client.query('BEGIN');

  const org = (
    await client.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt")
       VALUES (gen_random_uuid(), 'آزمون', 'verify-' || substr(md5(random()::text),1,8), now())
       RETURNING id`,
    )
  ).rows[0].id;

  const building = (
    await client.query(
      `INSERT INTO buildings (id, "organizationId", name, code, "updatedAt")
       VALUES (gen_random_uuid(), $1, 'ساختمان آزمون', 'V1', now())
       RETURNING id`,
      [org],
    )
  ).rows[0].id;

  const unit = (
    await client.query(
      `INSERT INTO units (id, "buildingId", label, "updatedAt")
       VALUES (gen_random_uuid(), $1, 'U1', now()) RETURNING id`,
      [building],
    )
  ).rows[0].id;

  const person = (
    await client.query(
      `INSERT INTO people (id, "firstName", "lastName", "updatedAt")
       VALUES (gen_random_uuid(), 'علی', 'رضایی', now()) RETURNING id`,
    )
  ).rows[0].id;

  const person2 = (
    await client.query(
      `INSERT INTO people (id, "firstName", "lastName", "updatedAt")
       VALUES (gen_random_uuid(), 'مریم', 'کریمی', now()) RETURNING id`,
    )
  ).rows[0].id;

  const ownership = (start, end, who = person, share = 100, primary_ = false) =>
    attempt(
      `INSERT INTO unit_ownerships
         (id, "buildingId", "unitId", "personId", "periodStart", "periodEnd",
          "sharePercent", "isPrimary", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now())`,
      [building, unit, who, start, end, share, primary_],
    );

  // --- Ownership -----------------------------------------------------------
  await expectAccepted('ownership: first period inserts', () =>
    ownership('2024-01-01T00:00:00Z', '2024-06-01T00:00:00Z'),
  );

  await expectRejected(
    'ownership: same person, overlapping period is rejected',
    'unit_ownerships_no_overlap',
    () => ownership('2024-03-01T00:00:00Z', '2024-09-01T00:00:00Z'),
  );

  // Half-open [) semantics: a handover on the exact boundary must be legal.
  await expectAccepted('ownership: adjacent period on the boundary is allowed', () =>
    ownership('2024-06-01T00:00:00Z', '2024-12-01T00:00:00Z'),
  );

  // Joint ownership is legitimate — the constraint keys on personId too.
  await expectAccepted('ownership: a DIFFERENT person may overlap (joint title)', () =>
    ownership('2024-03-01T00:00:00Z', '2024-05-01T00:00:00Z', person2, 50),
  );

  await expectRejected(
    'ownership: period ending before it starts is rejected',
    'unit_ownerships_period_order',
    () => ownership('2025-01-01T00:00:00Z', '2024-01-01T00:00:00Z', person2),
  );

  await expectRejected(
    'ownership: share above 100% is rejected',
    'unit_ownerships_share_range',
    () => ownership('2030-01-01T00:00:00Z', null, person2, 101),
  );

  await expectAccepted('ownership: one open primary is allowed', () =>
    ownership('2026-01-01T00:00:00Z', null, person, 100, true),
  );

  await expectRejected(
    'ownership: a SECOND open primary owner is rejected',
    'unit_ownerships_single_primary_current',
    () => ownership('2027-01-01T00:00:00Z', null, person2, 100, true),
  );

  // --- Occupancy -----------------------------------------------------------
  const occupancy = (start, end, kind = 'TENANT', who = person) =>
    attempt(
      `INSERT INTO unit_occupancies
         (id, "buildingId", "unitId", "personId", kind, "periodStart", "periodEnd",
          "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4::"OccupancyKind", $5, $6, now())`,
      [building, unit, who, kind, start, end],
    );

  await expectAccepted('occupancy: first period inserts', () =>
    occupancy('2024-01-01T00:00:00Z', '2024-06-01T00:00:00Z'),
  );

  await expectRejected(
    'occupancy: ANY overlap on the same unit is rejected (even another person)',
    'unit_occupancies_no_overlap',
    () => occupancy('2024-05-01T00:00:00Z', '2024-08-01T00:00:00Z', 'TENANT', person2),
  );

  await expectRejected(
    'occupancy: VACANT with a person attached is rejected',
    'unit_occupancies_person_matches_kind',
    () =>
      attempt(
        `INSERT INTO unit_occupancies
           (id, "buildingId", "unitId", "personId", kind, "periodStart", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, 'VACANT', '2030-01-01T00:00:00Z', now())`,
        [building, unit, person],
      ),
  );

  await expectRejected(
    'occupancy: TENANT with no person is rejected',
    'unit_occupancies_person_matches_kind',
    () =>
      attempt(
        `INSERT INTO unit_occupancies
           (id, "buildingId", "unitId", kind, "periodStart", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 'TENANT', '2031-01-01T00:00:00Z', now())`,
        [building, unit],
      ),
  );

  // --- Management terms (BM-00 rule 1) -------------------------------------
  const term = (n, start, end, status = 'ACTIVE') =>
    attempt(
      `INSERT INTO management_terms
         (id, "buildingId", "termNumber", status, "startsAt", "endsAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3::"ManagementTermStatus", $4, $5, now())`,
      [building, n, status, start, end],
    );

  await expectAccepted('term: first active term inserts', () =>
    term(1, '2024-01-01T00:00:00Z', '2025-01-01T00:00:00Z'),
  );

  await expectRejected(
    'term: a second term overlapping the active one is rejected',
    'management_terms',
    () => term(2, '2024-06-01T00:00:00Z', '2025-06-01T00:00:00Z', 'SCHEDULED'),
  );

  // History must stay writable: a COMPLETED term is outside the constraint.
  await expectAccepted('term: a COMPLETED historical term may overlap', () =>
    term(3, '2024-03-01T00:00:00Z', '2024-09-01T00:00:00Z', 'COMPLETED'),
  );

  await expectRejected(
    'term: a second ACTIVE term is rejected even with no time overlap',
    'management_terms_single_active',
    () => term(4, '2090-01-01T00:00:00Z', null, 'ACTIVE'),
  );
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
