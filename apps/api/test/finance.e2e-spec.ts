/**
 * BM-03 finance e2e — financial periods and the ledger, against a real database.
 *
 * WHAT THIS SUITE IS FOR: the finance rules that are easy to claim and hard to
 * prove. Each block below maps to a section of BM-03 that costs real money when
 * it is wrong:
 *
 *   §9/§10  a sealed period stops accepting financial effects
 *   §64     one building's manager cannot see another building's ledger
 *   §23     invoice numbers are allocated without collision under concurrency
 *   §51     the same accounting month cannot be opened twice
 *
 * Everything goes through HTTP, with the real guards and the real Postgres
 * constraints in play. Where an assertion needs a ledger entry, it is written
 * through the service the application itself uses — never hand-planted SQL that
 * the API could not have produced.
 */
import request from 'supertest';

import {
  auth,
  createBuilding,
  createOrganization,
  createUnit,
  registerActor,
  type Actor,
} from './actors';
import {
  closeTestApp,
  createTestApp,
  resetDatabase,
  type TestContext,
} from './harness';
import { LedgerService } from '../src/core/finance/ledger.service';
import { PrismaService } from '../src/core/database/prisma.service';

jest.setTimeout(120_000);

describe('BM-03 finance', () => {
  let context: TestContext;
  let owner: Actor;
  let organizationId: string;
  let buildingId: string;
  let unitId: string;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);

    owner = await registerActor(context.server, 'fin-owner');
    organizationId = await createOrganization(context.server, owner);
    const building = await createBuilding(
      context.server,
      owner,
      organizationId,
    );
    buildingId = building.id;
    unitId = await createUnit(context.server, owner, buildingId, 'F-101');
  });

  /** Opens a Jalali month through the API and returns the created period. */
  async function openPeriod(year = 1404, month = 7) {
    const response = await request(context.server)
      .post(`/api/buildings/${buildingId}/financial-periods`)
      .set(...auth(owner))
      .send({ year, month })
      .expect(201);
    return response.body as Record<string, any>;
  }

  describe('§9 — the accounting month', () => {
    it('derives the Gregorian boundaries of a Jalali month server-side', async () => {
      const period = await openPeriod(1404, 7);

      expect(period.year).toBe(1404);
      expect(period.month).toBe(7);
      expect(period.status).toBe('OPEN');

      // Mehr 1404 begins late September 2025. Asserting the ORDERING and the
      // month length rather than an exact string keeps the test honest about
      // timezone handling without hardcoding an offset.
      const startsAt = new Date(period.startsAt);
      const endsAt = new Date(period.endsAt);
      expect(endsAt.getTime()).toBeGreaterThan(startsAt.getTime());

      const days = Math.round(
        (endsAt.getTime() - startsAt.getTime()) / 86_400_000,
      );
      // Mehr is the 7th month: 30 days.
      expect(days).toBe(30);
    });

    it('refuses to open the same accounting month twice', async () => {
      await openPeriod(1404, 7);

      const duplicate = await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-periods`)
        .set(...auth(owner))
        .send({ year: 1404, month: 7 })
        .expect(409);

      // The Persian message matters as much as the status: this is what a
      // manager actually sees.
      expect(duplicate.body.message).toContain('دوره مالی');
    });

    it('rejects an out-of-range month before it reaches the database', async () => {
      await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-periods`)
        .set(...auth(owner))
        .send({ year: 1404, month: 13 })
        .expect(400);
    });

    it('reports consecutive months as exactly contiguous', async () => {
      const mehr = await openPeriod(1404, 7);
      const aban = await openPeriod(1404, 8);

      // Half-open [start, end): no gap and no overlap, so no charge can fall
      // between two months or belong to both.
      expect(new Date(aban.startsAt).toISOString()).toBe(
        new Date(mehr.endsAt).toISOString(),
      );
    });
  });

  describe('§7/§8/§28 — the ledger is the source of truth', () => {
    /**
     * Posts through the REAL LedgerService rather than raw SQL: the point is to
     * exercise the code path the application uses, including its period checks.
     */
    async function post(
      periodId: string,
      direction: 'DEBIT' | 'CREDIT',
      amount: number,
      extra: Record<string, unknown> = {},
    ) {
      const ledger = context.app.get(LedgerService);
      const prisma = context.app.get(PrismaService);
      return prisma.$transaction((tx) =>
        ledger.post(tx, scopeFor(), {
          unitId,
          financialPeriodId: periodId,
          direction,
          amount,
          referenceType: direction === 'DEBIT' ? 'CHARGE' : 'PAYMENT',
          ...extra,
        }),
      );
    }

    function scopeFor() {
      return {
        userId: owner.userId,
        personId: owner.personId,
        organizationId,
        buildingId,
        permissions: new Set<string>(),
      } as any;
    }

    it('derives a unit balance from entries rather than a stored column', async () => {
      const period = await openPeriod();
      const ledger = context.app.get(LedgerService);

      await post(period.id, 'DEBIT', 2_000_000); // charge
      await post(period.id, 'CREDIT', 500_000); // partial payment

      const balance = await ledger.balanceFor(scopeFor(), unitId);

      expect(balance.debit).toBe(2_000_000);
      expect(balance.credit).toBe(500_000);
      // Positive = the unit owes. 2,000,000 charged minus 500,000 paid.
      expect(balance.outstanding).toBe(1_500_000);
    });

    it('produces the same balance no matter the order entries were written', async () => {
      const period = await openPeriod();
      const ledger = context.app.get(LedgerService);

      await post(period.id, 'CREDIT', 300_000);
      await post(period.id, 'DEBIT', 1_000_000);
      await post(period.id, 'CREDIT', 200_000);

      const balance = await ledger.balanceFor(scopeFor(), unitId);
      expect(balance.outstanding).toBe(500_000);
    });

    it('corrects a mistake with a reversal, leaving the original entry intact', async () => {
      const period = await openPeriod();
      const ledger = context.app.get(LedgerService);
      const prisma = context.app.get(PrismaService);

      const wrong = await post(period.id, 'DEBIT', 9_999_999);
      expect((await ledger.balanceFor(scopeFor(), unitId)).outstanding).toBe(
        9_999_999,
      );

      await prisma.$transaction((tx) =>
        ledger.reverse(tx, scopeFor(), wrong.id, {
          financialPeriodId: period.id,
          reason: 'مبلغ اشتباه وارد شده بود',
        }),
      );

      // Net effect is zero...
      expect((await ledger.balanceFor(scopeFor(), unitId)).outstanding).toBe(0);

      // ...but BOTH rows survive. A ledger that forgets the mistake cannot
      // settle a dispute about it (§46).
      const entries = await ledger.list(scopeFor(), { unitId });
      expect(entries).toHaveLength(2);
      expect(entries.some((e) => e.id === wrong.id)).toBe(true);
    });

    it('refuses to reverse the same entry twice', async () => {
      const period = await openPeriod();
      const ledger = context.app.get(LedgerService);
      const prisma = context.app.get(PrismaService);

      const entry = await post(period.id, 'DEBIT', 1_000_000);
      await prisma.$transaction((tx) =>
        ledger.reverse(tx, scopeFor(), entry.id, {
          financialPeriodId: period.id,
          reason: 'اصلاح نخست',
        }),
      );

      await expect(
        prisma.$transaction((tx) =>
          ledger.reverse(tx, scopeFor(), entry.id, {
            financialPeriodId: period.id,
            reason: 'اصلاح دوم',
          }),
        ),
      ).rejects.toThrow();
    });

    it('rejects a replayed idempotency key without a second financial effect (§34)', async () => {
      const period = await openPeriod();
      const ledger = context.app.get(LedgerService);

      await post(period.id, 'CREDIT', 750_000, {
        idempotencyKey: 'provider-callback-1',
      });

      await expect(
        post(period.id, 'CREDIT', 750_000, {
          idempotencyKey: 'provider-callback-1',
        }),
      ).rejects.toThrow();

      // The critical assertion: the retry changed NOTHING. Asserting only that
      // the call threw would pass even if the row had been written first.
      const balance = await ledger.balanceFor(scopeFor(), unitId);
      expect(balance.credit).toBe(750_000);
    });

    it('refuses a zero-amount entry', async () => {
      const period = await openPeriod();
      await expect(post(period.id, 'DEBIT', 0)).rejects.toThrow();
    });
  });

  describe('§10/§59 — a closed period is sealed', () => {
    it('closes an empty period and then refuses new financial effects', async () => {
      const period = await openPeriod();

      const closed = await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-periods/${period.id}/close`)
        .set(...auth(owner))
        .send({})
        .expect(201);

      expect(closed.body.status).toBe('CLOSED');
      expect(closed.body.closedAt).not.toBeNull();

      // THE headline rule: sealed months do not move.
      const ledger = context.app.get(LedgerService);
      const prisma = context.app.get(PrismaService);
      await expect(
        prisma.$transaction((tx) =>
          ledger.post(tx, scopeFor2(), {
            unitId,
            financialPeriodId: period.id,
            direction: 'DEBIT',
            amount: 100_000,
            referenceType: 'CHARGE',
          }),
        ),
      ).rejects.toThrow();
    });

    function scopeFor2() {
      return {
        userId: owner.userId,
        personId: owner.personId,
        organizationId,
        buildingId,
        permissions: new Set<string>(),
      } as any;
    }

    it('refuses to close the same period twice', async () => {
      const period = await openPeriod();
      await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-periods/${period.id}/close`)
        .set(...auth(owner))
        .send({})
        .expect(201);

      await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-periods/${period.id}/close`)
        .set(...auth(owner))
        .send({})
        .expect(409);
    });

    it('reopens a sealed period as REOPENED, never as OPEN', async () => {
      const period = await openPeriod();
      await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-periods/${period.id}/close`)
        .set(...auth(owner))
        .send({})
        .expect(201);

      const reopened = await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-periods/${period.id}/reopen`)
        .set(...auth(owner))
        .send({ reason: 'اصلاح صورت‌حساب واحد ۱۰۱ پس از بستن دوره' })
        .expect(201);

      // The distinction is the whole point: an auditor must be able to see that
      // this month was sealed and later unsealed (§10).
      expect(reopened.body.status).toBe('REOPENED');
      expect(reopened.body.reopenedAt).not.toBeNull();
      expect(reopened.body.reopenReason).toContain('اصلاح');
    });

    it('requires a reason to reopen', async () => {
      const period = await openPeriod();
      await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-periods/${period.id}/close`)
        .set(...auth(owner))
        .send({})
        .expect(201);

      await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-periods/${period.id}/reopen`)
        .set(...auth(owner))
        .send({ reason: 'کوتاه' })
        .expect(400);
    });

    it('refuses to reopen a period that was never closed', async () => {
      const period = await openPeriod();

      await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-periods/${period.id}/reopen`)
        .set(...auth(owner))
        .send({ reason: 'دوره‌ای که اصلاً بسته نشده است' })
        .expect(409);
    });
  });

  describe('§64 — financial isolation between buildings', () => {
    it('does not expose another building period to a manager of this one', async () => {
      // A second organization entirely — the strongest form of the boundary.
      const outsider = await registerActor(context.server, 'fin-outsider');
      const otherOrg = await createOrganization(
        context.server,
        outsider,
        'شرکت دیگر',
      );
      const otherBuilding = await createBuilding(
        context.server,
        outsider,
        otherOrg,
      );

      const foreignPeriod = await request(context.server)
        .post(`/api/buildings/${otherBuilding.id}/financial-periods`)
        .set(...auth(outsider))
        .send({ year: 1404, month: 7 })
        .expect(201);

      // Reading the foreign building's period through OUR building's URL must
      // fail. 404 rather than 403: telling the caller "that exists but is not
      // yours" leaks the existence of another tenant's data.
      await request(context.server)
        .get(
          `/api/buildings/${buildingId}/financial-periods/${foreignPeriod.body.id}`,
        )
        .set(...auth(owner))
        .expect(404);

      // And addressing the foreign building directly must be refused by the
      // scope guard before any handler runs.
      await request(context.server)
        .get(`/api/buildings/${otherBuilding.id}/financial-periods`)
        .set(...auth(owner))
        .expect(403);
    });

    it('keeps ledger balances separate per building', async () => {
      const period = await openPeriod();
      const ledger = context.app.get(LedgerService);
      const prisma = context.app.get(PrismaService);

      const scope = {
        userId: owner.userId,
        personId: owner.personId,
        organizationId,
        buildingId,
        permissions: new Set<string>(),
      } as any;

      await prisma.$transaction((tx) =>
        ledger.post(tx, scope, {
          unitId,
          financialPeriodId: period.id,
          direction: 'DEBIT',
          amount: 1_000_000,
          referenceType: 'CHARGE',
        }),
      );

      // A second building in the SAME organization must not see the figure.
      const sibling = await createBuilding(
        context.server,
        owner,
        organizationId,
      );
      const siblingBalance = await ledger.buildingBalance({
        ...scope,
        buildingId: sibling.id,
      } as any);

      expect(siblingBalance.outstanding).toBe(0);
      expect((await ledger.buildingBalance(scope)).outstanding).toBe(1_000_000);
    });
  });

  describe('§23 — invoice numbering', () => {
    it('never allocates the same number twice, even concurrently', async () => {
      const prisma = context.app.get(PrismaService);

      // Ten simultaneous allocations, exactly the double-click / multi-manager
      // case that a COUNT(*)+1 scheme gets wrong.
      const allocations = await Promise.all(
        Array.from({ length: 10 }, () =>
          prisma.$queryRawUnsafe<{ n: number }[]>(
            `SELECT next_invoice_number($1::uuid, 1404, 7) AS n`,
            buildingId,
          ),
        ),
      );

      const numbers = allocations.map((rows) => Number(rows[0]?.n));
      const distinct = new Set(numbers);

      expect(distinct.size).toBe(10);
      // Gap-free 1..10 — "predictable" in §23 means an auditor can spot a
      // missing invoice by reading the sequence.
      expect([...distinct].sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
    });

    it('numbers restart per accounting month', async () => {
      const prisma = context.app.get(PrismaService);

      const mehr = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT next_invoice_number($1::uuid, 1404, 7) AS n`,
        buildingId,
      );
      const aban = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT next_invoice_number($1::uuid, 1404, 8) AS n`,
        buildingId,
      );

      expect(Number(mehr[0]?.n)).toBe(1);
      expect(Number(aban[0]?.n)).toBe(1);
    });
  });
});
