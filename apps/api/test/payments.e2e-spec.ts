/**
 * BM-03 payments, settlement and credit, e2e against a real database.
 *
 * WHAT THIS SUITE IS FOR: the settlement promises whose failure modes are all
 * some version of "a resident's money is wrong and every screen still looks
 * right". Each block maps to a section:
 *
 *   §25  partial payment — PARTIALLY_PAID then PAID
 *   §26  overpayment becomes credit, never disappears
 *   §27  credit is applied to a later invoice
 *   §28  outstanding balance is DERIVED from the ledger
 *   §34  a replayed reference produces one payment and one ledger effect
 *   §35  the same provider reference never settles twice
 *   §36  manual entry demands a reference and an elevated permission
 *   §46  a payment is reversed, never deleted
 *   §10  a sealed period accepts no money
 *   §64  one building's manager cannot settle another building's invoice
 *
 * THE ASSERTION STYLE THAT MATTERS HERE: the invoice columns (`paidAmount`,
 * `balance`) are a CACHE and the ledger is the truth (§7). A bug that updates
 * one and not the other leaves the UI perfectly plausible and the books wrong,
 * so the important tests check BOTH — and check the ledger ROW COUNT too, since
 * two mistaken entries that cancel out leave the balance right and the ledger
 * corrupt.
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

describe('BM-03 payments & settlement', () => {
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

    owner = await registerActor(context.server, 'pay-owner');
    organizationId = await createOrganization(context.server, owner);
    const building = await createBuilding(context.server, owner, organizationId);
    buildingId = building.id;
  });

  // ---------------------------------------------------------------- helpers

  async function createUnit(label: string, target = buildingId, actor = owner) {
    const response = await request(context.server)
      .post(`/api/buildings/${target}/units`)
      .set(...auth(actor))
      .send({ label, areaSqm: 100 })
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

  async function createRule(
    amount: string,
    target = buildingId,
    actor = owner,
  ) {
    const response = await request(context.server)
      .post(`/api/buildings/${target}/charge-rules`)
      .set(...auth(actor))
      .send({
        name: unique('قانون '),
        calculationMethod: 'FIXED',
        configuration: { amount },
        effectiveFrom: '2020-01-01T00:00:00.000Z',
      })
      .expect(201);
    return response.body.id as string;
  }

  /**
   * Drives the whole §50 flow up to an issued invoice, because a payment test
   * needs a REAL obligation to settle — one built by the charge engine and
   * posted to the ledger, not a hand-inserted row that skips the debit the
   * payment is supposed to cancel out.
   */
  async function issuedInvoice(
    amount = '5000000',
    target = buildingId,
    actor = owner,
  ) {
    const unitId = await createUnit(unique('و'), target, actor);
    const period = await openPeriod(1404, 7, target, actor);
    await createRule(amount, target, actor);

    await request(context.server)
      .post(`/api/buildings/${target}/charge-runs`)
      .set(...auth(actor))
      .send({ financialPeriodId: period.id })
      .expect(201);

    const issued = await request(context.server)
      .post(`/api/buildings/${target}/invoices`)
      .set(...auth(actor))
      .send({ financialPeriodId: period.id })
      .expect(201);

    const invoice = issued.body.invoices.find(
      (candidate: any) => candidate.unitId === unitId,
    );

    return { unitId, periodId: period.id as string, invoice };
  }

  function pay(body: Record<string, unknown>, target = buildingId, actor = owner) {
    return request(context.server)
      .post(`/api/buildings/${target}/payments`)
      .set(...auth(actor))
      .send(body);
  }

  function statement(unitId: string, target = buildingId, actor = owner) {
    return request(context.server)
      .get(`/api/buildings/${target}/units/${unitId}/statement`)
      .set(...auth(actor));
  }

  function ledgerRowCount(unitId: string) {
    return context.prisma.ledgerEntry.count({ where: { unitId } });
  }

  // ------------------------------------------------------- §25 partial pay

  describe('§25 — partial payment', () => {
    it('moves the invoice to PARTIALLY_PAID and then to PAID', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');
      expect(invoice.total).toBe(5000000);

      const first = await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 2000000,
        method: 'MANUAL_BANK_TRANSFER',
        reference: unique('ref-'),
      }).expect(201);

      expect(first.body.settledAmount).toBe(2000000);
      expect(first.body.creditedAmount).toBe(0);
      expect(first.body.invoiceStatus).toBe('PARTIALLY_PAID');
      expect(first.body.invoiceBalance).toBe(3000000);

      const second = await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 3000000,
        method: 'MANUAL_CASH',
        reference: unique('ref-'),
      }).expect(201);

      expect(second.body.invoiceStatus).toBe('PAID');
      expect(second.body.invoiceBalance).toBe(0);

      // The spec's own example, checked against the DOCUMENT rather than the
      // response: 2,000,000 + 3,000,000 against a 5,000,000 invoice.
      const stored = await context.prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      expect(Number(stored.paidAmount)).toBe(5000000);
      expect(Number(stored.balance)).toBe(0);
      expect(stored.status).toBe('PAID');
      expect(stored.paidAt).not.toBeNull();
    });

    it('leaves the unit owing nothing once the invoice is settled in full', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');

      // The charge posted a 5,000,000 DEBIT, so the unit starts out owing.
      const before = await statement(unitId).expect(200);
      expect(before.body.outstanding).toBe(5000000);

      await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 5000000,
        method: 'MANUAL_BANK_TRANSFER',
        reference: unique('ref-'),
      }).expect(201);

      // §28 — outstanding is DERIVED from ledger entries, not read from a
      // column. Debit and credit are asserted separately so a test cannot pass
      // because two errors happened to cancel out.
      const after = await statement(unitId).expect(200);
      expect(after.body.debit).toBe(5000000);
      expect(after.body.credit).toBe(5000000);
      expect(after.body.outstanding).toBe(0);
    });
  });

  // -------------------------------------------------------- §26 overpayment

  describe('§26/§27 — overpayment becomes credit', () => {
    it('credits the excess to the unit instead of losing it', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');

      const response = await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 5500000,
        method: 'MANUAL_BANK_TRANSFER',
        reference: unique('ref-'),
      }).expect(201);

      // The spec's example verbatim: 5,500,000 against 5,000,000 leaves 500,000.
      expect(response.body.amount).toBe(5500000);
      expect(response.body.settledAmount).toBe(5000000);
      expect(response.body.creditedAmount).toBe(500000);
      expect(response.body.invoiceStatus).toBe('PAID');

      const credits = await context.prisma.unitCredit.findMany({
        where: { unitId },
      });
      expect(credits).toHaveLength(1);
      expect(Number(credits[0]!.remainingAmount)).toBe(500000);
      expect(credits[0]!.status).toBe('AVAILABLE');

      // The invoice must NOT absorb the excess as a negative balance.
      const stored = await context.prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      expect(Number(stored.balance)).toBe(0);
      expect(Number(stored.paidAmount)).toBe(5000000);
    });

    it('credits the FULL amount received to the ledger, overpayment included', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');

      await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 5500000,
        method: 'MANUAL_BANK_TRANSFER',
        reference: unique('ref-'),
      }).expect(201);

      // THE LOAD-BEARING ASSERTION OF THIS SUITE. The resident handed over
      // 5,500,000 and owed 5,000,000, so they are 500,000 IN CREDIT — the
      // balance is negative. Posting only the settled part would show 0 here
      // and quietly keep half a million off the books.
      const after = await statement(unitId).expect(200);
      expect(after.body.credit).toBe(5500000);
      expect(after.body.outstanding).toBe(-500000);

      // Reported separately rather than netted into the balance, so "money on
      // account" stays distinguishable from "owes less".
      expect(after.body.availableCredit).toBe(500000);
    });

    it('turns a payment with no invoice into pure credit', async () => {
      const { unitId } = await issuedInvoice('5000000');

      const response = await pay({
        unitId,
        amount: 1200000,
        method: 'MANUAL_CASH',
        reference: unique('ref-'),
      }).expect(201);

      expect(response.body.invoiceId).toBeNull();
      expect(response.body.settledAmount).toBe(0);
      expect(response.body.creditedAmount).toBe(1200000);

      const view = await statement(unitId).expect(200);
      expect(view.body.availableCredit).toBe(1200000);
      // Still credited to the ledger — an advance payment is money received.
      expect(view.body.credit).toBe(1200000);
    });
  });

  // ------------------------------------------------------ §27 credit apply

  describe('§27 — applying credit', () => {
    it('settles a later invoice WITHOUT touching the ledger', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');

      await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 5500000,
        method: 'MANUAL_BANK_TRANSFER',
        reference: unique('ref-'),
      }).expect(201);

      // A second month, so there is something for the credit to pay.
      const second = await openPeriod(1404, 8);
      await request(context.server)
        .post(`/api/buildings/${buildingId}/charge-runs`)
        .set(...auth(owner))
        .send({ financialPeriodId: second.id })
        .expect(201);
      const issued = await request(context.server)
        .post(`/api/buildings/${buildingId}/invoices`)
        .set(...auth(owner))
        .send({ financialPeriodId: second.id })
        .expect(201);
      const nextInvoice = issued.body.invoices.find(
        (candidate: any) => candidate.unitId === unitId,
      );

      const balanceBefore = (await statement(unitId).expect(200)).body;
      const rowsBefore = await ledgerRowCount(unitId);

      const applied = await request(context.server)
        .post(`/api/buildings/${buildingId}/credits/apply`)
        .set(...auth(owner))
        .send({ invoiceId: nextInvoice.id })
        .expect(201);

      expect(applied.body.appliedAmount).toBe(500000);
      expect(applied.body.invoiceBalance).toBe(4500000);
      expect(applied.body.invoiceStatus).toBe('PARTIALLY_PAID');
      expect(applied.body.remainingCredit).toBe(0);

      // THE POINT: the money was credited when it ARRIVED. Applying it moves it
      // onto a document and must record no second financial effect — the row
      // count is checked as well as the balance, because two opposing mistaken
      // entries would leave the balance right and the ledger wrong.
      const balanceAfter = (await statement(unitId).expect(200)).body;
      expect(balanceAfter.outstanding).toBe(balanceBefore.outstanding);
      expect(balanceAfter.credit).toBe(balanceBefore.credit);
      expect(await ledgerRowCount(unitId)).toBe(rowsBefore);

      // The credit itself is spent, not still on offer.
      expect(balanceAfter.availableCredit).toBe(0);
      const credits = await context.prisma.unitCredit.findMany({
        where: { unitId },
      });
      expect(credits[0]!.status).toBe('APPLIED');
      expect(Number(credits[0]!.remainingAmount)).toBe(0);
    });

    it('refuses to apply credit the unit does not have', async () => {
      const { invoice } = await issuedInvoice('5000000');

      await request(context.server)
        .post(`/api/buildings/${buildingId}/credits/apply`)
        .set(...auth(owner))
        .send({ invoiceId: invoice.id })
        .expect(409);
    });

    it('never applies more credit than the invoice owes', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');

      // Pay the invoice off and leave a large credit behind.
      await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 5000000,
        method: 'MANUAL_BANK_TRANSFER',
        reference: unique('ref-'),
      }).expect(201);
      await pay({
        unitId,
        amount: 9000000,
        method: 'MANUAL_CASH',
        reference: unique('ref-'),
      }).expect(201);

      const second = await openPeriod(1404, 8);
      await request(context.server)
        .post(`/api/buildings/${buildingId}/charge-runs`)
        .set(...auth(owner))
        .send({ financialPeriodId: second.id })
        .expect(201);
      const issued = await request(context.server)
        .post(`/api/buildings/${buildingId}/invoices`)
        .set(...auth(owner))
        .send({ financialPeriodId: second.id })
        .expect(201);
      const nextInvoice = issued.body.invoices.find(
        (candidate: any) => candidate.unitId === unitId,
      );

      const applied = await request(context.server)
        .post(`/api/buildings/${buildingId}/credits/apply`)
        .set(...auth(owner))
        .send({ invoiceId: nextInvoice.id })
        .expect(201);

      // 9,000,000 available against a 5,000,000 invoice: it takes exactly what
      // is owed and leaves the rest spendable. An invoice can never go negative.
      expect(applied.body.appliedAmount).toBe(5000000);
      expect(applied.body.invoiceBalance).toBe(0);
      expect(applied.body.invoiceStatus).toBe('PAID');
      expect(applied.body.remainingCredit).toBe(4000000);
    });
  });

  // ----------------------------------------------- §34/§35 no double settle

  describe('§34/§35 — one reference, one settlement', () => {
    it('refuses a second payment carrying the same reference', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');
      const reference = unique('ref-');

      await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 2000000,
        method: 'MANUAL_BANK_TRANSFER',
        reference,
      }).expect(201);

      await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 2000000,
        method: 'MANUAL_BANK_TRANSFER',
        reference,
      }).expect(409);

      // The rejection must leave NOTHING behind. Asserting only the 409 would
      // pass even if the row had been written and then failed on the ledger.
      const payments = await context.prisma.payment.count({ where: { unitId } });
      expect(payments).toBe(1);

      const stored = await context.prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      expect(Number(stored.paidAmount)).toBe(2000000);
    });

    it('survives four concurrent submissions of the same receipt', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');
      const reference = unique('ref-');

      const body = {
        unitId,
        invoiceId: invoice.id,
        amount: 1000000,
        method: 'MANUAL_BANK_TRANSFER' as const,
        reference,
      };

      const responses = await Promise.all([
        pay(body),
        pay(body),
        pay(body),
        pay(body),
      ]);

      const created = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);

      expect(created).toHaveLength(1);
      expect(conflicts).toHaveLength(3);
      // No raw 500s: the loser of a race must get the Persian 409, not a stack
      // trace. This is the assertion that caught untranslated unique violations
      // in ownership, periods and invoicing.
      expect(responses.filter((r) => r.status >= 500)).toHaveLength(0);

      // §34 — one payment, ONE ledger effect. The unit must be credited
      // 1,000,000 exactly once, not four times.
      const payments = await context.prisma.payment.count({ where: { unitId } });
      expect(payments).toBe(1);

      const view = await statement(unitId).expect(200);
      expect(view.body.credit).toBe(1000000);
      expect(view.body.outstanding).toBe(4000000);
    });
  });

  // -------------------------------------------------------- §36 manual rules

  describe('§36 — manual entry is a controlled fallback', () => {
    it('refuses a payment with no reference', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');

      await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 1000000,
        method: 'MANUAL_CASH',
        reference: '',
      }).expect(400);

      expect(await context.prisma.payment.count({ where: { unitId } })).toBe(0);
    });

    it('refuses a zero or negative amount', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');

      await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 0,
        method: 'MANUAL_CASH',
        reference: unique('ref-'),
      }).expect(400);

      await pay({
        unitId,
        invoiceId: invoice.id,
        amount: -500000,
        method: 'MANUAL_CASH',
        reference: unique('ref-'),
      }).expect(400);

      expect(await context.prisma.payment.count({ where: { unitId } })).toBe(0);
    });

    it('records who entered the payment', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');

      const response = await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 1000000,
        method: 'MANUAL_POS',
        reference: unique('ref-'),
      }).expect(201);

      // §36 requires the creator be auditable from the row itself, not only
      // from a log line somewhere else.
      const stored = await context.prisma.payment.findUniqueOrThrow({
        where: { id: response.body.id },
      });
      expect(stored.recordedByPersonId).not.toBeNull();
      expect(stored.provider).toBe('MANUAL');
      expect(stored.status).toBe('SUCCEEDED');
      expect(stored.verifiedAt).not.toBeNull();
    });

    it('refuses to settle an invoice belonging to a different unit', async () => {
      const { invoice } = await issuedInvoice('5000000');
      const otherUnit = await createUnit(unique('و'));

      // Every row here is individually valid; only the COMBINATION is wrong,
      // which is exactly the case a per-row check misses.
      await pay({
        unitId: otherUnit,
        invoiceId: invoice.id,
        amount: 1000000,
        method: 'MANUAL_CASH',
        reference: unique('ref-'),
      }).expect(409);
    });
  });

  // ------------------------------------------------------------ §46 reversal

  describe('§46 — reversal, not deletion', () => {
    it('undoes the money without erasing the payment', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');

      const payment = await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 5000000,
        method: 'MANUAL_BANK_TRANSFER',
        reference: unique('ref-'),
      }).expect(201);

      expect((await statement(unitId).expect(200)).body.outstanding).toBe(0);

      await request(context.server)
        .post(`/api/buildings/${buildingId}/payments/${payment.body.id}/reverse`)
        .set(...auth(owner))
        .send({ reason: 'چک برگشت خورد' })
        .expect(201);

      // The debt is back — and the ledger GREW rather than shrank, because a
      // correction is a new opposing entry, never an edit (§7/§46).
      const after = await statement(unitId).expect(200);
      expect(after.body.outstanding).toBe(5000000);
      expect(after.body.debit).toBe(10000000);
      expect(after.body.credit).toBe(5000000);

      // The payment row survives, marked REVERSED.
      const stored = await context.prisma.payment.findUniqueOrThrow({
        where: { id: payment.body.id },
      });
      expect(stored.status).toBe('REVERSED');

      // The invoice is owed again.
      const storedInvoice = await context.prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      expect(Number(storedInvoice.paidAmount)).toBe(0);
      expect(Number(storedInvoice.balance)).toBe(5000000);
      expect(storedInvoice.status).toBe('ISSUED');
      expect(storedInvoice.paidAt).toBeNull();
    });

    it('withdraws unspent credit created by the reversed payment', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');

      const payment = await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 5500000,
        method: 'MANUAL_BANK_TRANSFER',
        reference: unique('ref-'),
      }).expect(201);

      expect((await statement(unitId).expect(200)).body.availableCredit).toBe(
        500000,
      );

      await request(context.server)
        .post(`/api/buildings/${buildingId}/payments/${payment.body.id}/reverse`)
        .set(...auth(owner))
        .send({ reason: 'واریز اشتباه' })
        .expect(201);

      // Money that never arrived cannot stay on account.
      expect((await statement(unitId).expect(200)).body.availableCredit).toBe(0);
    });

    it('refuses to reverse the same payment twice', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');

      const payment = await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 1000000,
        method: 'MANUAL_CASH',
        reference: unique('ref-'),
      }).expect(201);

      await request(context.server)
        .post(`/api/buildings/${buildingId}/payments/${payment.body.id}/reverse`)
        .set(...auth(owner))
        .send({ reason: 'اشتباه ثبت شد' })
        .expect(201);

      await request(context.server)
        .post(`/api/buildings/${buildingId}/payments/${payment.body.id}/reverse`)
        .set(...auth(owner))
        .send({ reason: 'دوباره' })
        .expect(409);

      // A double reversal would DEBIT the unit twice for one mistaken payment.
      const view = await statement(unitId).expect(200);
      expect(view.body.debit).toBe(6000000);
    });

    it('refuses a reversal with no reason', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');

      const payment = await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 1000000,
        method: 'MANUAL_CASH',
        reference: unique('ref-'),
      }).expect(201);

      await request(context.server)
        .post(`/api/buildings/${buildingId}/payments/${payment.body.id}/reverse`)
        .set(...auth(owner))
        .send({ reason: '  ' })
        .expect(400);
    });
  });

  // -------------------------------------------------- §24/§10 refused states

  describe('states that refuse money', () => {
    it('refuses payment against a cancelled invoice', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');

      await request(context.server)
        .post(`/api/buildings/${buildingId}/invoices/${invoice.id}/cancel`)
        .set(...auth(owner))
        .send({ reason: 'صدور اشتباه' })
        .expect(201);

      await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 1000000,
        method: 'MANUAL_CASH',
        reference: unique('ref-'),
      }).expect(409);
    });

    it('refuses payment against an already paid invoice', async () => {
      const { unitId, invoice } = await issuedInvoice('5000000');

      await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 5000000,
        method: 'MANUAL_BANK_TRANSFER',
        reference: unique('ref-'),
      }).expect(201);

      await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 1000000,
        method: 'MANUAL_CASH',
        reference: unique('ref-'),
      }).expect(409);
    });

    it('§10 — refuses money into a closed period', async () => {
      const { unitId, invoice, periodId } = await issuedInvoice('5000000');

      await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-periods/${periodId}/close`)
        .set(...auth(owner))
        .send({ allowUnsettledInvoices: true })
        .expect(201);

      await pay({
        unitId,
        invoiceId: invoice.id,
        amount: 1000000,
        method: 'MANUAL_CASH',
        reference: unique('ref-'),
        financialPeriodId: periodId,
      }).expect(409);

      expect(await context.prisma.payment.count({ where: { unitId } })).toBe(0);
    });
  });

  // ------------------------------------------------------------ §64 isolation

  describe('§64 — financial isolation between buildings', () => {
    it("refuses to settle another building's invoice", async () => {
      const { invoice } = await issuedInvoice('5000000');

      const stranger = await registerActor(context.server, 'pay-stranger');
      const strangerOrg = await createOrganization(context.server, stranger);
      const strangerBuilding = await createBuilding(
        context.server,
        stranger,
        strangerOrg,
      );
      const strangerUnit = await createUnit(
        unique('و'),
        strangerBuilding.id,
        stranger,
      );

      // The invoice id is real, the actor is a legitimate manager — of a
      // DIFFERENT building. The tenant boundary is the only thing standing
      // between them and settling someone else's books.
      await pay(
        {
          unitId: strangerUnit,
          invoiceId: invoice.id,
          amount: 1000000,
          method: 'MANUAL_CASH',
          reference: unique('ref-'),
        },
        strangerBuilding.id,
        stranger,
      ).expect(404);

      const payments = await context.prisma.payment.count();
      expect(payments).toBe(0);
    });

    it("refuses to read another building's unit statement", async () => {
      const { unitId } = await issuedInvoice('5000000');

      const stranger = await registerActor(context.server, 'pay-stranger2');
      const strangerOrg = await createOrganization(context.server, stranger);
      const strangerBuilding = await createBuilding(
        context.server,
        stranger,
        strangerOrg,
      );

      await statement(unitId, strangerBuilding.id, stranger).expect(404);
    });
  });
});
