/**
 * BM-03 invoicing and extraordinary charges, e2e against a real database.
 *
 * WHAT THIS SUITE IS FOR: the invoicing promises that are cheap to claim and
 * expensive to get wrong. Each block maps to a section whose failure mode costs
 * a resident real money or costs the building its audit trail:
 *
 *   §70  Charge ≠ Invoice ≠ Payment — issuing must NOT move the ledger
 *   §22  one invoice per unit, bundling that unit's charges as lines
 *   §23  invoice numbers unique, gap-free and never reused
 *   §24  a wrong invoice is cancelled, never deleted
 *   §20  an extraordinary charge without a reason is impossible
 *   §10  a sealed period accepts no new documents
 *   §64  one building's manager cannot invoice another building
 *
 * Everything runs through HTTP with the real guards, the real Persian error
 * pipeline and the real Postgres constraints. Assertions are written against
 * OBSERVABLE STATE — the ledger balance, the row count, the stored number — not
 * merely against status codes. A guard that returns 409 AFTER writing is still a
 * double billing, and a test that only checked the code would call it green.
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

describe('BM-03 invoicing', () => {
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

    owner = await registerActor(context.server, 'inv-owner');
    organizationId = await createOrganization(context.server, owner);
    const building = await createBuilding(context.server, owner, organizationId);
    buildingId = building.id;
  });

  async function createSizedUnit(
    label: string,
    areaSqm: number,
    target = buildingId,
    actor = owner,
  ) {
    const response = await request(context.server)
      .post(`/api/buildings/${target}/units`)
      .set(...auth(actor))
      .send({ label, areaSqm })
      .expect(201);
    return response.body.id as string;
  }

  async function openPeriod(
    year = 1404,
    month = 7,
    target = buildingId,
    actor = owner,
  ) {
    const response = await request(context.server)
      .post(`/api/buildings/${target}/financial-periods`)
      .set(...auth(actor))
      .send({ year, month })
      .expect(201);
    return response.body as Record<string, any>;
  }

  function createRule(
    body: Record<string, unknown> = {},
    target = buildingId,
    actor = owner,
  ) {
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

  function generate(
    body: Record<string, unknown> = {},
    target = buildingId,
    actor = owner,
  ) {
    return request(context.server)
      .post(`/api/buildings/${target}/charge-runs`)
      .set(...auth(actor))
      .send(body);
  }

  function issue(
    body: Record<string, unknown> = {},
    target = buildingId,
    actor = owner,
  ) {
    return request(context.server)
      .post(`/api/buildings/${target}/invoices`)
      .set(...auth(actor))
      .send(body);
  }

  /** A building with two units, one FIXED rule, and the month already generated. */
  async function buildingWithGeneratedMonth() {
    const unitA = await createSizedUnit('A1', 100);
    const unitB = await createSizedUnit('B1', 50);
    const period = await openPeriod();
    await createRule().expect(201);

    const run = await generate({ financialPeriodId: period.id }).expect(201);

    return { unitA, unitB, period, run: run.body as Record<string, any> };
  }

  /** The unit's outstanding balance straight from the ledger (§7/§28). */
  async function outstandingFor(unitId: string): Promise<number> {
    const entries = await context.prisma.ledgerEntry.findMany({
      where: { buildingId, unitId },
      select: { direction: true, amount: true },
    });

    return entries.reduce(
      (total, entry) =>
        entry.direction === 'DEBIT'
          ? total + Number(entry.amount)
          : total - Number(entry.amount),
      0,
    );
  }

  describe('§70 — an invoice is a document, not a second obligation', () => {
    it('does NOT change the unit balance when invoicing', async () => {
      const { unitA, period } = await buildingWithGeneratedMonth();

      // The charge already debited the unit. This is THE test that catches
      // someone "helpfully" adding a ledger post to the issue path: it would
      // double every resident's balance while every screen still looked right.
      const before = await outstandingFor(unitA);
      expect(before).toBe(2_000_000);

      await issue({ financialPeriodId: period.id }).expect(201);

      const after = await outstandingFor(unitA);
      expect(after).toBe(before);
    });

    it('writes no ledger entries at all during issuance', async () => {
      const { period } = await buildingWithGeneratedMonth();

      const before = await context.prisma.ledgerEntry.count({
        where: { buildingId },
      });

      await issue({ financialPeriodId: period.id }).expect(201);

      // Asserted as a COUNT rather than a balance because two mistaken entries
      // that cancel out would leave the balance correct and the ledger wrong.
      const after = await context.prisma.ledgerEntry.count({
        where: { buildingId },
      });
      expect(after).toBe(before);
    });

    it('reports an invoice total equal to the charges it bills', async () => {
      const { period } = await buildingWithGeneratedMonth();

      const issued = await issue({ financialPeriodId: period.id }).expect(201);

      expect(issued.body.invoicesIssued).toBe(2);
      expect(issued.body.totalAmount).toBe(4_000_000);
      for (const invoice of issued.body.invoices) {
        expect(invoice.total).toBe(2_000_000);
        expect(invoice.balance).toBe(2_000_000);
        expect(invoice.paidAmount).toBe(0);
        expect(invoice.status).toBe('ISSUED');
      }
    });
  });

  describe('§22 — one invoice per unit, bundling its charges as lines', () => {
    it('puts a unit’s monthly and extraordinary charges on ONE document', async () => {
      const unitA = await createSizedUnit('A1', 100);
      const period = await openPeriod();
      await createRule({ name: unique('ماهانه ') }).expect(201);
      await generate({ financialPeriodId: period.id }).expect(201);

      // A second, one-off levy in the same month — §22's own example shows the
      // monthly charge and an extraordinary charge on one invoice, not two.
      await request(context.server)
        .post(`/api/buildings/${buildingId}/extraordinary-charges`)
        .set(...auth(owner))
        .send({
          title: 'تعویض کابین آسانسور',
          reason: 'مصوبه مجمع عمومی فوق‌العاده',
          approvalReference: 'صورت‌جلسه ۱۴۰۴/۰۷/۱۲',
          calculationMethod: 'FIXED',
          configuration: { amount: '5000000' },
          financialPeriodId: period.id,
        })
        .expect(201);

      const issued = await issue({ financialPeriodId: period.id }).expect(201);

      expect(issued.body.invoicesIssued).toBe(1);
      const invoice = issued.body.invoices[0];
      expect(invoice.unitId).toBe(unitA);
      expect(invoice.lines).toHaveLength(2);
      expect(invoice.total).toBe(7_000_000);

      // The line total must equal the header, or the document contradicts itself.
      const lineSum = invoice.lines.reduce(
        (total: number, line: any) => total + line.amount,
        0,
      );
      expect(lineSum).toBe(invoice.total);
    });

    it('copies the description onto the line rather than referencing it', async () => {
      const period = await openPeriod();
      await createSizedUnit('A1', 100);
      await createRule({ name: 'شارژ ماهانه مهر' }).expect(201);
      await generate({ financialPeriodId: period.id }).expect(201);

      const issued = await issue({ financialPeriodId: period.id }).expect(201);
      const line = issued.body.invoices[0].lines[0];

      // A document whose wording changes when master data is edited is not
      // evidence of what was billed.
      expect(line.description).toBe('شارژ ماهانه مهر');
      expect(line.amount).toBe(2_000_000);
      expect(line.unitPrice).toBe(2_000_000);
    });
  });

  describe('§21/§51 — a charge is billed at most once', () => {
    it('refuses a second issue for a month already invoiced', async () => {
      const { period } = await buildingWithGeneratedMonth();

      await issue({ financialPeriodId: period.id }).expect(201);

      // Nothing is left to bill, so the second call must refuse rather than
      // silently produce empty documents with burned invoice numbers.
      const second = await issue({ financialPeriodId: period.id }).expect(409);
      expect(second.body.message).toContain('صورت‌حساب');

      const invoices = await context.prisma.invoice.count({
        where: { buildingId },
      });
      expect(invoices).toBe(2);
    });

    it('never bills one charge twice under concurrent issue requests', async () => {
      const { period } = await buildingWithGeneratedMonth();

      // Four simultaneous requests — the double-click, the retry, the overlapping
      // cron. The claim that matters is not "some got 409": it is that the
      // DATABASE ends up with exactly two invoices and two lines.
      const responses = await Promise.all([
        issue({ financialPeriodId: period.id }),
        issue({ financialPeriodId: period.id }),
        issue({ financialPeriodId: period.id }),
        issue({ financialPeriodId: period.id }),
      ]);

      const created = responses.filter((response) => response.status === 201);
      expect(created).toHaveLength(1);

      // A raw 500 would mean an untranslated constraint reached the client — the
      // exact bug ownership and management terms both shipped once.
      expect(responses.some((response) => response.status >= 500)).toBe(false);

      const invoices = await context.prisma.invoice.count({
        where: { buildingId },
      });
      expect(invoices).toBe(2);

      const lines = await context.prisma.invoiceLine.count({
        where: { buildingId },
      });
      expect(lines).toBe(2);
    });

    it('marks billed charges INVOICED so the next run skips them', async () => {
      const { period } = await buildingWithGeneratedMonth();
      await issue({ financialPeriodId: period.id }).expect(201);

      const remaining = await context.prisma.charge.count({
        where: { buildingId, status: { in: ['DRAFT', 'ISSUED'] } },
      });
      expect(remaining).toBe(0);
    });
  });

  describe('§23 — numbering is unique, gap-free and predictable', () => {
    it('numbers invoices sequentially within the Jalali period', async () => {
      const { period } = await buildingWithGeneratedMonth();

      const issued = await issue({ financialPeriodId: period.id }).expect(201);

      const numbers = issued.body.invoices
        .map((invoice: any) => invoice.invoiceNumber)
        .sort();

      expect(numbers).toEqual(['1404-07-000001', '1404-07-000002']);
    });

    it('never reuses a number after an invoice is cancelled', async () => {
      const { period } = await buildingWithGeneratedMonth();

      const issued = await issue({ financialPeriodId: period.id }).expect(201);
      const first = issued.body.invoices[0];

      await request(context.server)
        .post(`/api/buildings/${buildingId}/invoices/${first.id}/cancel`)
        .set(...auth(owner))
        .send({ reason: 'مبلغ اشتباه محاسبه شده بود' })
        .expect(201);

      // Re-issuing the released charge must take the NEXT number, never the
      // cancelled one. §23 is explicit: not reused after issuance.
      const reissued = await issue({ financialPeriodId: period.id }).expect(201);
      const reissuedNumber = reissued.body.invoices[0].invoiceNumber;

      expect(reissuedNumber).toBe('1404-07-000003');
      expect(reissuedNumber).not.toBe(first.invoiceNumber);
    });
  });

  describe('§24 — a wrong invoice is cancelled, never deleted', () => {
    it('keeps the row and releases its charges to be billed again', async () => {
      const { period } = await buildingWithGeneratedMonth();
      const issued = await issue({ financialPeriodId: period.id }).expect(201);
      const invoice = issued.body.invoices[0];

      const cancelled = await request(context.server)
        .post(`/api/buildings/${buildingId}/invoices/${invoice.id}/cancel`)
        .set(...auth(owner))
        .send({ reason: 'صادر شده برای واحد اشتباه' })
        .expect(201);

      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.balance).toBe(0);

      // The document survives with its number (R2) — it is not deleted.
      const stillThere = await context.prisma.invoice.findUnique({
        where: { id: invoice.id },
      });
      expect(stillThere).not.toBeNull();
      expect(stillThere?.invoiceNumber).toBe(invoice.invoiceNumber);

      // And its charge is billable again, which is what makes correction possible.
      const releasable = await context.prisma.charge.count({
        where: { buildingId, status: 'ISSUED' },
      });
      expect(releasable).toBe(1);
    });

    it('does not forgive the debt when the document is cancelled', async () => {
      const { unitA, period } = await buildingWithGeneratedMonth();
      const issued = await issue({ financialPeriodId: period.id }).expect(201);
      const invoice = issued.body.invoices.find(
        (candidate: any) => candidate.unitId === unitA,
      );

      await request(context.server)
        .post(`/api/buildings/${buildingId}/invoices/${invoice.id}/cancel`)
        .set(...auth(owner))
        .send({ reason: 'اشتباه در صدور' })
        .expect(201);

      // Cancelling the DOCUMENT must not cancel the OBLIGATION. Writing a credit
      // here would forgive a debt nobody decided to forgive.
      expect(await outstandingFor(unitA)).toBe(2_000_000);
    });

    it('refuses to cancel twice', async () => {
      const { period } = await buildingWithGeneratedMonth();
      const issued = await issue({ financialPeriodId: period.id }).expect(201);
      const invoice = issued.body.invoices[0];

      const url = `/api/buildings/${buildingId}/invoices/${invoice.id}/cancel`;
      await request(context.server)
        .post(url)
        .set(...auth(owner))
        .send({ reason: 'اشتباه در صدور' })
        .expect(201);

      const again = await request(context.server)
        .post(url)
        .set(...auth(owner))
        .send({ reason: 'دوباره' })
        .expect(409);

      expect(again.body.message).toContain('باطل');
    });

    it('requires a reason to cancel', async () => {
      const { period } = await buildingWithGeneratedMonth();
      const issued = await issue({ financialPeriodId: period.id }).expect(201);

      // An unexplained cancellation is exactly what an auditor cannot accept.
      await request(context.server)
        .post(
          `/api/buildings/${buildingId}/invoices/${issued.body.invoices[0].id}/cancel`,
        )
        .set(...auth(owner))
        .send({})
        .expect(400);
    });

    it('offers no DELETE route at all', async () => {
      const { period } = await buildingWithGeneratedMonth();
      const issued = await issue({ financialPeriodId: period.id }).expect(201);

      // The absence IS the feature (§24). A 404 here means the route does not
      // exist, which is what keeps a paid invoice undeletable.
      await request(context.server)
        .delete(`/api/buildings/${buildingId}/invoices/${issued.body.invoices[0].id}`)
        .set(...auth(owner))
        .expect(404);
    });
  });

  describe('§20 — an extraordinary charge must be explained', () => {
    function levy(body: Record<string, unknown> = {}) {
      return request(context.server)
        .post(`/api/buildings/${buildingId}/extraordinary-charges`)
        .set(...auth(owner))
        .send({
          title: 'تعمیر پشت‌بام',
          reason: 'نشت آب در واحدهای طبقه آخر',
          calculationMethod: 'FIXED',
          configuration: { amount: '3000000' },
          ...body,
        });
    }

    it('records the reason and approval on the charge and its snapshot', async () => {
      await createSizedUnit('A1', 100);
      const period = await openPeriod();

      const created = await levy({
        financialPeriodId: period.id,
        approvalReference: 'صورت‌جلسه ۸۸',
      }).expect(201);

      expect(created.body.unitsCharged).toBe(1);
      expect(created.body.totalAmount).toBe(3_000_000);

      const charge = await context.prisma.charge.findFirst({
        where: { buildingId, chargeType: 'EXTRAORDINARY' },
        include: { snapshot: true },
      });

      expect(charge?.reason).toBe('نشت آب در واحدهای طبقه آخر');
      // No standing rule produced this — that is what the nullable column is for.
      expect(charge?.chargeRuleId).toBeNull();
      // §18/§20 — the approval must be in the RECORD, not just in the request.
      expect((charge?.snapshot?.inputs as any)?.approvalReference).toBe(
        'صورت‌جلسه ۸۸',
      );
    });

    it('refuses a levy with no reason', async () => {
      await createSizedUnit('A1', 100);
      await openPeriod();

      await levy({ reason: undefined }).expect(400);
    });

    it('refuses a reason that is only whitespace', async () => {
      await createSizedUnit('A1', 100);
      await openPeriod();

      // A blank-looking reason passes the DTO's MinLength(3) and still produces
      // exactly the unexplained line item §20 exists to prevent, so the service
      // trims and refuses. 409 rather than 400 matches how every other mandatory
      // reason in this domain is refused (period reopen, ledger reversal).
      const refused = await levy({ reason: '     ' }).expect(409);
      expect(refused.body.message).toContain('دلیل');

      // The claim that matters is not the status code: nothing was written.
      const charges = await context.prisma.charge.count({
        where: { buildingId },
      });
      expect(charges).toBe(0);
    });

    it('debits the unit so the levy is a real obligation', async () => {
      const unitA = await createSizedUnit('A1', 100);
      const period = await openPeriod();

      await levy({ financialPeriodId: period.id }).expect(201);

      expect(await outstandingFor(unitA)).toBe(3_000_000);
    });

    it('allows two different levies in the same month', async () => {
      await createSizedUnit('A1', 100);
      const period = await openPeriod();

      // A lift replacement and an emergency roof repair in one Mehr are two real
      // charges, not a duplicate — the §51 anti-duplicate index deliberately
      // covers only rule-generated charges.
      await levy({ financialPeriodId: period.id, title: 'آسانسور' }).expect(201);
      await levy({ financialPeriodId: period.id, title: 'پشت‌بام' }).expect(201);

      const charges = await context.prisma.charge.count({
        where: { buildingId, chargeType: 'EXTRAORDINARY' },
      });
      expect(charges).toBe(2);
    });
  });

  describe('§10 — a sealed period accepts no new documents', () => {
    it('refuses to issue into a closed period', async () => {
      const { period } = await buildingWithGeneratedMonth();

      await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-periods/${period.id}/close`)
        .set(...auth(owner))
        .send({ allowUnsettledInvoices: true })
        .expect(201);

      const refused = await issue({ financialPeriodId: period.id }).expect(409);
      expect(refused.body.message).toContain('بسته');

      // Refused BEFORE any number was allocated — §23 promises numbers are never
      // reused, so a burned number would leave a permanent gap.
      const invoices = await context.prisma.invoice.count({
        where: { buildingId },
      });
      expect(invoices).toBe(0);
    });

    it('refuses an extraordinary levy into a closed period', async () => {
      await createSizedUnit('A1', 100);
      const period = await openPeriod();

      await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-periods/${period.id}/close`)
        .set(...auth(owner))
        .send({ allowUnsettledInvoices: true })
        .expect(201);

      await request(context.server)
        .post(`/api/buildings/${buildingId}/extraordinary-charges`)
        .set(...auth(owner))
        .send({
          title: 'تعمیر',
          reason: 'ضروری',
          calculationMethod: 'FIXED',
          configuration: { amount: '1000000' },
          financialPeriodId: period.id,
        })
        .expect(409);
    });
  });

  describe('§64 — invoices never cross a building boundary', () => {
    it('refuses to issue into a building the manager has no membership in', async () => {
      const { period } = await buildingWithGeneratedMonth();

      const stranger = await registerActor(context.server, 'inv-stranger');
      const strangerOrg = await createOrganization(context.server, stranger);
      const strangerBuilding = await createBuilding(
        context.server,
        stranger,
        strangerOrg,
      );

      // The stranger holds INVOICE_ISSUE in their OWN building, so the only
      // thing standing in the way here is the tenant boundary itself.
      const refused = await issue(
        { financialPeriodId: period.id },
        buildingId,
        stranger,
      );
      expect([403, 404]).toContain(refused.status);

      // The assertion that matters: nothing was written to the victim building.
      const invoices = await context.prisma.invoice.count({
        where: { buildingId },
      });
      expect(invoices).toBe(0);
      expect(strangerBuilding.id).not.toBe(buildingId);
    });

    it('does not return another building’s invoice by id', async () => {
      const { period } = await buildingWithGeneratedMonth();
      const issued = await issue({ financialPeriodId: period.id }).expect(201);

      const stranger = await registerActor(context.server, 'inv-peeker');
      const strangerOrg = await createOrganization(context.server, stranger);
      const strangerBuilding = await createBuilding(
        context.server,
        stranger,
        strangerOrg,
      );

      // Asking their OWN building for someone else's invoice id must 404 — the
      // id is unguessable in practice, but the scope must not be the only guard.
      await request(context.server)
        .get(
          `/api/buildings/${strangerBuilding.id}/invoices/${issued.body.invoices[0].id}`,
        )
        .set(...auth(stranger))
        .expect(404);
    });
  });

  describe('reading invoices', () => {
    it('lists issued invoices with their lines', async () => {
      const { period } = await buildingWithGeneratedMonth();
      await issue({ financialPeriodId: period.id }).expect(201);

      const listed = await request(context.server)
        .get(`/api/buildings/${buildingId}/invoices`)
        .set(...auth(owner))
        .expect(200);

      expect(listed.body).toHaveLength(2);
      expect(listed.body[0].lines.length).toBeGreaterThan(0);
      // Money must arrive as a number, never as a serialised Decimal object.
      expect(typeof listed.body[0].total).toBe('number');
    });

    it('filters by status', async () => {
      const { period } = await buildingWithGeneratedMonth();
      const issued = await issue({ financialPeriodId: period.id }).expect(201);

      await request(context.server)
        .post(
          `/api/buildings/${buildingId}/invoices/${issued.body.invoices[0].id}/cancel`,
        )
        .set(...auth(owner))
        .send({ reason: 'اشتباه' })
        .expect(201);

      const open = await request(context.server)
        .get(`/api/buildings/${buildingId}/invoices?status=ISSUED`)
        .set(...auth(owner))
        .expect(200);

      expect(open.body).toHaveLength(1);
      expect(open.body[0].status).toBe('ISSUED');
    });
  });
});
