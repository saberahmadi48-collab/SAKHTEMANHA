/**
 * BM-03 charge rules and monthly generation, e2e against a real database.
 *
 * WHAT THIS SUITE IS FOR: the promises of BM-03 that are cheap to claim in a
 * code review and expensive to get wrong in production. Each block maps to a
 * section whose failure mode is money:
 *
 *   §52  a revision never alters what a past charge was based on
 *   §50  configured rules, not typed amounts, produce the month's charges
 *   §51  the same month cannot be generated twice — nobody is billed twice
 *   §10  a sealed period refuses new financial effects
 *   §64  one building's manager cannot generate into another building
 *
 * Everything runs through HTTP with the real guards, the real Persian error
 * pipeline and the real Postgres constraints. Assertions are written against
 * OBSERVABLE STATE — the ledger balance, the row count — not merely against
 * status codes: a guard that returns 409 after writing is still a double
 * billing, and a test that only checked the code would call it green.
 */
import request from 'supertest';

import {
  auth,
  createBuilding,
  createOrganization,
  registerActor,
  type Actor,
} from './actors';
import {
  closeTestApp,
  createTestApp,
  resetDatabase,
  unique,
  type TestContext,
} from './harness';

jest.setTimeout(180_000);

describe('BM-03 charge rules and generation', () => {
  let context: TestContext;
  let owner: Actor;
  let organizationId: string;
  let buildingId: string;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);

    owner = await registerActor(context.server, 'chg-owner');
    organizationId = await createOrganization(context.server, owner);
    const building = await createBuilding(context.server, owner, organizationId);
    buildingId = building.id;
  });

  /** Creates a unit with an area, so area-based rules have real inputs. */
  async function createSizedUnit(label: string, areaSqm: number, target = buildingId, actor = owner) {
    const response = await request(context.server)
      .post(`/api/buildings/${target}/units`)
      .set(...auth(actor))
      .send({ label, areaSqm })
      .expect(201);
    return response.body.id as string;
  }

  async function openPeriod(year = 1404, month = 7, target = buildingId, actor = owner) {
    const response = await request(context.server)
      .post(`/api/buildings/${target}/financial-periods`)
      .set(...auth(actor))
      .send({ year, month })
      .expect(201);
    return response.body as Record<string, any>;
  }

  /** The effectivity window must cover the period being generated. */
  function createRule(body: Record<string, unknown>, target = buildingId, actor = owner) {
    return request(context.server)
      .post(`/api/buildings/${target}/charge-rules`)
      .set(...auth(actor))
      .send({
        name: unique('قانون '),
        calculationMethod: 'FIXED',
        configuration: { amount: '2000000' },
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        ...body,
      });
  }

  function generate(body: Record<string, unknown> = {}, target = buildingId, actor = owner) {
    return request(context.server)
      .post(`/api/buildings/${target}/charge-runs`)
      .set(...auth(actor))
      .send(body);
  }

  describe('§12/§19 — rules are configuration, validated by running them', () => {
    it('stores a rule as version 1 and ACTIVE', async () => {
      const created = await createRule({}).expect(201);

      expect(created.body.version).toBe(1);
      expect(created.body.status).toBe('ACTIVE');
      expect(created.body.configuration).toEqual({ amount: '2000000' });
    });

    it('refuses a configuration the engine cannot execute', async () => {
      // AREA_BASED needs `totalCost`; `amount` is the FIXED key. Catching this
      // at configuration time is the whole point — the alternative is a rule
      // that saves cleanly and then aborts the monthly run.
      const rejected = await createRule({
        calculationMethod: 'AREA_BASED',
        configuration: { amount: '5000000' },
      }).expect(409);

      expect(rejected.body.message).toContain('تنظیمات قانون شارژ');
    });

    it('refuses a method BM-03 deliberately leaves unimplemented (§17)', async () => {
      // CUSTOM throws from the engine rather than inventing a number. It must
      // be impossible to SAVE, not merely impossible to run.
      await createRule({
        calculationMethod: 'CUSTOM',
        configuration: { expression: 'area * 2' },
      }).expect(409);
    });

    it('refuses a second live rule with the same name', async () => {
      const name = unique('شارژ ');
      await createRule({ name }).expect(201);

      // Two live rules of one name would both match during generation and put
      // the same thing on the invoice twice.
      const clash = await createRule({ name }).expect(409);
      expect(clash.body.message).toContain('قانون شارژ');
    });
  });

  describe('§52 — a revision supersedes, it never edits', () => {
    it('keeps the old version intact and marks it SUPERSEDED', async () => {
      const created = await createRule({
        configuration: { amount: '2000000' },
      }).expect(201);

      const revised = await request(context.server)
        .post(`/api/buildings/${buildingId}/charge-rules/${created.body.id}/revise`)
        .set(...auth(owner))
        .send({
          configuration: { amount: '3000000' },
          effectiveFrom: '2030-01-01T00:00:00.000Z',
        })
        .expect(201);

      expect(revised.body.version).toBe(2);
      expect(revised.body.id).not.toBe(created.body.id);

      // THE LOAD-BEARING ASSERTION: the original row still claims the original
      // amount. If a revision could edit in place, a charge produced last month
      // would point at a row describing a figure that never produced it.
      const original = await request(context.server)
        .get(`/api/buildings/${buildingId}/charge-rules/${created.body.id}`)
        .set(...auth(owner))
        .expect(200);

      expect(original.body.configuration).toEqual({ amount: '2000000' });
      expect(original.body.status).toBe('SUPERSEDED');
      expect(original.body.version).toBe(1);
    });

    it('hides superseded versions from the default list but keeps them retrievable', async () => {
      const created = await createRule({}).expect(201);
      await request(context.server)
        .post(`/api/buildings/${buildingId}/charge-rules/${created.body.id}/revise`)
        .set(...auth(owner))
        .send({
          configuration: { amount: '3000000' },
          effectiveFrom: '2030-01-01T00:00:00.000Z',
        })
        .expect(201);

      const live = await request(context.server)
        .get(`/api/buildings/${buildingId}/charge-rules`)
        .set(...auth(owner))
        .expect(200);
      expect(live.body).toHaveLength(1);
      expect(live.body[0].version).toBe(2);

      // The audit view: history is never destroyed, only filtered by default.
      const withHistory = await request(context.server)
        .get(`/api/buildings/${buildingId}/charge-rules?includeSuperseded=true`)
        .set(...auth(owner))
        .expect(200);
      expect(withHistory.body).toHaveLength(2);
    });

    it('exposes no way to edit a rule in place', async () => {
      const created = await createRule({}).expect(201);

      // §52 depends on this absence. If a PUT/PATCH ever appears, historical
      // charges stop being reproducible while every screen still looks fine.
      await request(context.server)
        .put(`/api/buildings/${buildingId}/charge-rules/${created.body.id}`)
        .set(...auth(owner))
        .send({ configuration: { amount: '9' } })
        .expect(404);

      await request(context.server)
        .patch(`/api/buildings/${buildingId}/charge-rules/${created.body.id}`)
        .set(...auth(owner))
        .send({ configuration: { amount: '9' } })
        .expect(404);

      await request(context.server)
        .delete(`/api/buildings/${buildingId}/charge-rules/${created.body.id}`)
        .set(...auth(owner))
        .expect(404);
    });
  });

  describe('§50 — the month is generated from configuration', () => {
    it('charges every unit from an active rule, with no per-unit data entry', async () => {
      await createSizedUnit('G-101', 100);
      await createSizedUnit('G-102', 100);
      const period = await openPeriod();
      await createRule({ configuration: { amount: '2000000' } }).expect(201);

      const run = await generate({ financialPeriodId: period.id }).expect(201);

      expect(run.body.unitsEvaluated).toBe(2);
      expect(run.body.chargesCreated).toBe(2);
      expect(run.body.totalAmount).toBe(4000000);
      expect(run.body.completedAt).not.toBeNull();
    });

    it('splits an area-based cost so the parts sum EXACTLY to the total', async () => {
      // Three equal units and a total that does not divide evenly is the case
      // that loses a rial to rounding. apportion gives the remainder to the
      // largest weight; the invariant is that nothing disappears.
      await createSizedUnit('A-1', 100);
      await createSizedUnit('A-2', 100);
      await createSizedUnit('A-3', 100);
      const period = await openPeriod();
      await createRule({
        calculationMethod: 'AREA_BASED',
        configuration: { totalCost: '1000000' },
      }).expect(201);

      const run = await generate({ financialPeriodId: period.id }).expect(201);

      expect(run.body.chargesCreated).toBe(3);
      expect(run.body.totalAmount).toBe(1000000);
    });

    it('writes a versioned snapshot beside every charge (§18/§52)', async () => {
      await createSizedUnit('S-101', 120);
      const period = await openPeriod();
      const rule = await createRule({
        configuration: { amount: '2000000' },
      }).expect(201);

      await generate({ financialPeriodId: period.id }).expect(201);

      // Read the stored proof directly: this is the artefact that makes a
      // six-month-old figure defensible, and it must exist per charge.
      const snapshots = await context.prisma.chargeCalculationSnapshot.findMany({
        where: { buildingId },
      });

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.formulaVersion).toBe(1);
      expect(snapshots[0]?.chargeRuleId).toBe(rule.body.id);
      expect(snapshots[0]?.inputs).toBeTruthy();
    });

    it('posts the obligation to the ledger as a DEBIT', async () => {
      const unitId = await createSizedUnit('L-101', 100);
      const period = await openPeriod();
      await createRule({ configuration: { amount: '2000000' } }).expect(201);

      await generate({ financialPeriodId: period.id }).expect(201);

      const entries = await context.prisma.ledgerEntry.findMany({
        where: { buildingId, unitId },
      });

      // Sign convention (§7/§8): DEBIT increases what the unit owes.
      expect(entries).toHaveLength(1);
      expect(entries[0]?.direction).toBe('DEBIT');
      expect(entries[0]?.referenceType).toBe('CHARGE');
      expect(Number(entries[0]?.amount)).toBe(2000000);
    });

    it('opens the current period itself when none is given', async () => {
      await createSizedUnit('N-101', 100);
      await createRule({ configuration: { amount: '1500000' } }).expect(201);

      const run = await generate().expect(201);
      expect(run.body.chargesCreated).toBe(1);

      // §50 "Month Starts -> Open Financial Period": the manager did not open
      // the month, so the run did.
      const current = await request(context.server)
        .get(`/api/buildings/${buildingId}/financial-periods/current`)
        .set(...auth(owner))
        .expect(200);
      expect(current.body.id).toBe(run.body.financialPeriodId);
    });

    it('applies a rule only to the unit kinds it targets', async () => {
      await createSizedUnit('P-101', 100);
      await request(context.server)
        .post(`/api/buildings/${buildingId}/units`)
        .set(...auth(owner))
        .send({ label: 'PK-1', kind: 'PARKING', areaSqm: 15 })
        .expect(201);

      const period = await openPeriod();
      await createRule({
        configuration: { amount: '2000000' },
        appliesToUnitKinds: ['RESIDENTIAL'],
      }).expect(201);

      const run = await generate({ financialPeriodId: period.id }).expect(201);

      // Both units were evaluated; only the residential one was charged.
      expect(run.body.unitsEvaluated).toBe(2);
      expect(run.body.chargesCreated).toBe(1);
    });

    it('refuses to run a month that has no active rule', async () => {
      await createSizedUnit('E-101', 100);
      const period = await openPeriod();

      const refused = await generate({ financialPeriodId: period.id }).expect(409);
      expect(refused.body.message).toBeTruthy();
    });
  });

  describe('§51 — the same month cannot be billed twice', () => {
    it('refuses a second run and leaves the first run untouched', async () => {
      await createSizedUnit('D-101', 100);
      await createSizedUnit('D-102', 100);
      const period = await openPeriod();
      await createRule({ configuration: { amount: '2000000' } }).expect(201);

      await generate({ financialPeriodId: period.id }).expect(201);

      const second = await generate({ financialPeriodId: period.id }).expect(409);
      expect(second.body.message).toContain('شارژ');

      // THE ASSERTION THAT MATTERS: not the status code, but that no second
      // charge exists. A 409 returned after writing is still a double billing.
      const charges = await context.prisma.charge.count({ where: { buildingId } });
      expect(charges).toBe(2);

      const entries = await context.prisma.ledgerEntry.count({
        where: { buildingId },
      });
      expect(entries).toBe(2);
    });

    it('survives a double-click: concurrent runs never double-charge', async () => {
      await createSizedUnit('C-101', 100);
      await createSizedUnit('C-102', 100);
      const period = await openPeriod();
      await createRule({ configuration: { amount: '2000000' } }).expect(201);

      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          generate({ financialPeriodId: period.id }),
        ),
      );

      const statuses = results.map((result) =>
        result.status === 'fulfilled' ? result.value.status : 500,
      );

      // Exactly one winner, and — the part that is easy to get wrong — no raw
      // 500s for the losers. The unique violation must reach the manager as a
      // Persian 409, which is the same lesson management terms and ownership
      // taught: translate EVERY constraint that can fire, not just one.
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 500)).toHaveLength(0);

      // And the database agrees: two units, two charges. Not eight.
      const charges = await context.prisma.charge.count({ where: { buildingId } });
      expect(charges).toBe(2);
    });
  });

  describe('§10 — a sealed month refuses new charges', () => {
    it('refuses generation into a closed period', async () => {
      await createSizedUnit('X-101', 100);
      const period = await openPeriod();
      await createRule({ configuration: { amount: '2000000' } }).expect(201);

      await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-periods/${period.id}/close`)
        .set(...auth(owner))
        .send({})
        .expect(201);

      const refused = await generate({ financialPeriodId: period.id }).expect(409);
      expect(refused.body.message).toContain('بسته');

      // Nothing was written on the way to that refusal.
      const charges = await context.prisma.charge.count({ where: { buildingId } });
      expect(charges).toBe(0);
    });
  });

  describe('§64 — tenant isolation', () => {
    it('refuses a rule id from another building', async () => {
      const rule = await createRule({}).expect(201);

      const otherOwner = await registerActor(context.server, 'chg-other');
      const otherOrg = await createOrganization(context.server, otherOwner);
      const otherBuilding = await createBuilding(
        context.server,
        otherOwner,
        otherOrg,
      );

      // otherOwner HAS the permission in their own building — so the only thing
      // that can refuse this is the tenant boundary itself, which is what makes
      // the test meaningful. 404, not 403: the id must not be confirmed to
      // exist at all.
      await request(context.server)
        .get(`/api/buildings/${otherBuilding.id}/charge-rules/${rule.body.id}`)
        .set(...auth(otherOwner))
        .expect(404);
    });

    it('keeps generation inside its own building', async () => {
      await createSizedUnit('T-101', 100);

      const otherOwner = await registerActor(context.server, 'chg-other2');
      const otherOrg = await createOrganization(context.server, otherOwner);
      const otherBuilding = await createBuilding(
        context.server,
        otherOwner,
        otherOrg,
      );
      await createSizedUnit('T-201', 100, otherBuilding.id, otherOwner);
      const otherPeriod = await openPeriod(1404, 7, otherBuilding.id, otherOwner);
      await createRule(
        { configuration: { amount: '2000000' } },
        otherBuilding.id,
        otherOwner,
      ).expect(201);

      const run = await generate(
        { financialPeriodId: otherPeriod.id },
        otherBuilding.id,
        otherOwner,
      ).expect(201);

      // One unit charged — theirs. The first building's unit was never seen.
      expect(run.body.chargesCreated).toBe(1);

      const foreignCharges = await context.prisma.charge.count({
        where: { buildingId },
      });
      expect(foreignCharges).toBe(0);
    });

    it('refuses an outsider with no membership', async () => {
      const outsider = await registerActor(context.server, 'chg-outsider');

      await request(context.server)
        .get(`/api/buildings/${buildingId}/charge-rules`)
        .set(...auth(outsider))
        .expect(403);

      await generate({}, buildingId, outsider).expect(403);
    });
  });
});
