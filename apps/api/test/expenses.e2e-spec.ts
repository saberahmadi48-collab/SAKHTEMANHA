/**
 * BM-03 expenses, income and financial categories, e2e against a real database.
 *
 * WHAT THIS SUITE IS FOR: the building-side promises whose failure modes all
 * look fine on screen. Each block maps to a section:
 *
 *   §38  a supplier bill is entered as a draft with no financial effect
 *   §39  approval authority is separated from entry — no self-approval
 *   §40  ONLY payment posts to the ledger; approval posts nothing
 *   §41  income recorded outside the charge pipeline credits the building
 *   §42  categories are per-building data, retired rather than deleted
 *   §53  the manager dashboard figures
 *   §10  a sealed period accepts no expense payment
 *   §64  one building's manager cannot touch another building's expense
 *
 * THE ASSERTION STYLE THAT MATTERS HERE: an expense must never reach a UNIT
 * balance. Several tests therefore check the unit statement is untouched, not
 * merely that the expense row says PAID — a bug that split the cost across units
 * would leave every expense screen correct and quietly double-bill residents,
 * since the charge formula (§12) already turns building costs into resident
 * obligations.
 *
 * Ledger ROW COUNT is asserted alongside balances for the same reason as the
 * payments suite: two mistaken entries that cancel out leave the balance right
 * and the books corrupt.
 */
import request from 'supertest';

import {
  auth,
  createBuilding,
  createOrganization,
  inviteAndAccept,
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

describe('BM-03 expenses & income', () => {
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

    owner = await registerActor(context.server, 'exp-owner');
    organizationId = await createOrganization(context.server, owner);
    const building = await createBuilding(context.server, owner, organizationId);
    buildingId = building.id;
  });

  // ---------------------------------------------------------------- helpers

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

  async function createCategory(
    kind: 'EXPENSE' | 'INCOME',
    target = buildingId,
    actor = owner,
  ) {
    const response = await request(context.server)
      .post(`/api/buildings/${target}/financial-categories`)
      .set(...auth(actor))
      .send({ kind, name: unique(kind === 'EXPENSE' ? 'هزینه ' : 'درآمد ') })
      .expect(201);
    return response.body.id as string;
  }

  /**
   * Posts an expense and asserts the status itself.
   *
   * It takes `expectStatus` rather than returning a chainable supertest request
   * because it must `await` the category lookup first — which makes it an async
   * function returning a Promise, and a Promise has no `.expect()`. Asserting
   * inside is the honest shape; the alternative would be leaking an unawaited
   * chain that silently passes when the request fails.
   */
  async function createExpense(
    body: Record<string, unknown> = {},
    expectStatus = 201,
    target = buildingId,
    actor = owner,
  ) {
    const categoryId =
      (body.categoryId as string) ??
      (await createCategory('EXPENSE', target, actor));

    return request(context.server)
      .post(`/api/buildings/${target}/expenses`)
      .set(...auth(actor))
      .send({
        categoryId,
        vendorName: 'شرکت آسانسور تهران',
        description: 'تعمیر موتور آسانسور',
        amount: 12000000,
        expenseDate: '2025-09-20T00:00:00.000Z',
        ...body,
      })
      .expect(expectStatus);
  }

  function expensePath(expenseId: string, action = '', target = buildingId) {
    return `/api/buildings/${target}/expenses/${expenseId}${action}`;
  }

  /**
   * Drives an expense to APPROVED using a SECOND person as the approver.
   *
   * The owner cannot approve their own entry (§39), so a test that needs an
   * approved expense must model the real two-person flow rather than work around
   * the control it is meant to respect.
   */
  async function approvedExpense(amount = 12000000) {
    const created = await createExpense({ amount });
    await request(context.server)
      .post(expensePath(created.body.id, '/submit'))
      .set(...auth(owner))
      .expect(201);

    const approver = await addApprover();
    await request(context.server)
      .post(expensePath(created.body.id, '/approve'))
      .set(...auth(approver))
      .expect(201);

    return created.body.id as string;
  }

  /**
   * Registers a second actor and makes them a BOARD_MEMBER — the role that
   * holds EXPENSE_APPROVE while deliberately lacking EXPENSE_CREATE.
   *
   * Goes through the invitation round trip because that is the ONLY way a
   * membership is created in this platform (§33): there is no `POST /members`,
   * and inserting one directly would test a door that does not exist.
   */
  async function addApprover(target = buildingId) {
    const approver = await registerActor(context.server, unique('exp-board-'));

    await inviteAndAccept(context.server, owner, approver, {
      buildingId: target,
      role: 'BOARD_MEMBER',
    });

    return approver;
  }

  async function ledgerCount(where: Record<string, unknown> = {}) {
    return context.prisma.ledgerEntry.count({
      where: { buildingId, ...where },
    });
  }

  // ------------------------------------------------------------ §42 categories

  describe('§42 — categories are configurable per building', () => {
    it('creates categories on both sides of the books', async () => {
      const expenseId = await createCategory('EXPENSE');
      const incomeId = await createCategory('INCOME');

      expect(expenseId).not.toBe(incomeId);

      const list = await request(context.server)
        .get(`/api/buildings/${buildingId}/financial-categories`)
        .set(...auth(owner))
        .expect(200);

      expect(list.body).toHaveLength(2);
    });

    it('refuses two categories with the same name on the same side', async () => {
      const name = unique('نظافت ');

      await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-categories`)
        .set(...auth(owner))
        .send({ kind: 'EXPENSE', name })
        .expect(201);

      // A duplicate splits the building's reporting in half without anyone
      // noticing, so this is a 409 rather than a silently accepted second row.
      await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-categories`)
        .set(...auth(owner))
        .send({ kind: 'EXPENSE', name })
        .expect(409);

      // The SAME name on the other side of the books is a different category
      // and must be allowed — "Elevator" can be both a cost and a revenue line.
      await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-categories`)
        .set(...auth(owner))
        .send({ kind: 'INCOME', name })
        .expect(201);
    });

    it('refuses to delete a category that has been used, and deactivates instead', async () => {
      const categoryId = await createCategory('EXPENSE');
      await createExpense({ categoryId });

      // Deleting would orphan the expense that points at it.
      await request(context.server)
        .delete(`/api/buildings/${buildingId}/financial-categories/${categoryId}`)
        .set(...auth(owner))
        .expect(409);

      await request(context.server)
        .patch(`/api/buildings/${buildingId}/financial-categories/${categoryId}`)
        .set(...auth(owner))
        .send({ isActive: false })
        .expect(200);

      // Retired: hidden from the default picker, but the historical expense
      // still resolves its category.
      const active = await request(context.server)
        .get(`/api/buildings/${buildingId}/financial-categories`)
        .set(...auth(owner))
        .expect(200);
      expect(active.body).toHaveLength(0);

      const all = await request(context.server)
        .get(`/api/buildings/${buildingId}/financial-categories?activeOnly=false`)
        .set(...auth(owner))
        .expect(200);
      expect(all.body).toHaveLength(1);
    });

    it('refuses a new expense against a retired category', async () => {
      const categoryId = await createCategory('EXPENSE');

      await request(context.server)
        .patch(`/api/buildings/${buildingId}/financial-categories/${categoryId}`)
        .set(...auth(owner))
        .send({ isActive: false })
        .expect(200);

      // Otherwise "retired" would mean nothing.
      await createExpense({ categoryId }, 409);
    });

    it('refuses an expense filed under an income category', async () => {
      const incomeCategory = await createCategory('INCOME');

      // Filing a cost under a revenue line makes BOTH sides of the report wrong
      // at once, which is why the kind is checked rather than trusted.
      await createExpense({ categoryId: incomeCategory }, 409);
    });
  });

  // ------------------------------------------------------- §38/§39/§40 flow

  describe('§38/§39/§40 — the approval chain', () => {
    it('enters a draft with NO financial effect', async () => {
      const created = await createExpense();

      expect(created.body.status).toBe('DRAFT');
      // The structural expression of "not yet money": null until PAID.
      expect(created.body.ledgerEntryId).toBeNull();
      expect(await ledgerCount()).toBe(0);
    });

    it('walks DRAFT → SUBMITTED → APPROVED writing nothing to the ledger', async () => {
      const created = await createExpense();

      const submitted = await request(context.server)
        .post(expensePath(created.body.id, '/submit'))
        .set(...auth(owner))
        .expect(201);
      expect(submitted.body.status).toBe('SUBMITTED');
      expect(await ledgerCount()).toBe(0);

      const approver = await addApprover();
      const approved = await request(context.server)
        .post(expensePath(created.body.id, '/approve'))
        .set(...auth(approver))
        .expect(201);

      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.approvedByPersonId).toBe(approver.personId);
      // THE ASSERTION THIS SUITE EXISTS FOR: approval is a DECISION. Posting
      // here would show the money gone while it is still in the account.
      expect(approved.body.ledgerEntryId).toBeNull();
      expect(await ledgerCount()).toBe(0);
    });

    it('posts exactly one building-level DEBIT when paid', async () => {
      await openPeriod();
      const expenseId = await approvedExpense(12000000);

      const paid = await request(context.server)
        .post(expensePath(expenseId, '/pay'))
        .set(...auth(owner))
        .send({})
        .expect(201);

      expect(paid.body.status).toBe('PAID');
      expect(paid.body.ledgerEntryId).not.toBeNull();

      expect(await ledgerCount()).toBe(1);

      const entry = await context.prisma.ledgerEntry.findUniqueOrThrow({
        where: { id: paid.body.ledgerEntryId },
      });
      expect(entry.direction).toBe('DEBIT');
      expect(entry.referenceType).toBe('EXPENSE');
      expect(Number(entry.amount)).toBe(12000000);
      // §7 — building-level. This is the field that keeps a supplier bill off
      // every resident's balance.
      expect(entry.unitId).toBeNull();
    });

    it('never touches a unit balance when an expense is paid', async () => {
      await openPeriod();

      const unitId = (
        await request(context.server)
          .post(`/api/buildings/${buildingId}/units`)
          .set(...auth(owner))
          .send({ label: unique('و'), areaSqm: 100 })
          .expect(201)
      ).body.id as string;

      const before = await request(context.server)
        .get(`/api/buildings/${buildingId}/units/${unitId}/statement`)
        .set(...auth(owner))
        .expect(200);

      const expenseId = await approvedExpense(12000000);
      await request(context.server)
        .post(expensePath(expenseId, '/pay'))
        .set(...auth(owner))
        .send({})
        .expect(201);

      const after = await request(context.server)
        .get(`/api/buildings/${buildingId}/units/${unitId}/statement`)
        .set(...auth(owner))
        .expect(200);

      // A 12,000,000 lift repair must not appear on any resident's statement.
      // It becomes their obligation only through the charge formula (§12).
      expect(after.body.outstanding).toBe(before.body.outstanding);
      expect(after.body.debit).toBe(before.body.debit);
      expect(await ledgerCount({ unitId })).toBe(0);
    });

    it('refuses to pay the same expense twice', async () => {
      await openPeriod();
      const expenseId = await approvedExpense(12000000);

      await request(context.server)
        .post(expensePath(expenseId, '/pay'))
        .set(...auth(owner))
        .send({})
        .expect(201);

      await request(context.server)
        .post(expensePath(expenseId, '/pay'))
        .set(...auth(owner))
        .send({})
        .expect(409);

      // The guard has to hold in the LEDGER, not just in the response: a second
      // DEBIT would double the building's recorded spend.
      expect(await ledgerCount()).toBe(1);
    });

    it('survives four concurrent pay attempts with one ledger effect', async () => {
      await openPeriod();
      const expenseId = await approvedExpense(12000000);

      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          request(context.server)
            .post(expensePath(expenseId, '/pay'))
            .set(...auth(owner))
            .send({}),
        ),
      );

      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      // No raw 500s — the loser of a race must get the Persian 409, not a stack
      // trace. This is the assertion that caught untranslated unique violations
      // across ownership, periods, invoicing and payments.
      expect(responses.filter((r) => r.status >= 500)).toHaveLength(0);

      expect(await ledgerCount()).toBe(1);
    });

    it('refuses to pay an expense that was never approved', async () => {
      await openPeriod();
      const created = await createExpense();

      await request(context.server)
        .post(expensePath(created.body.id, '/pay'))
        .set(...auth(owner))
        .send({})
        .expect(409);

      await request(context.server)
        .post(expensePath(created.body.id, '/submit'))
        .set(...auth(owner))
        .expect(201);

      // SUBMITTED is still not APPROVED — paying here would skip §39 entirely.
      await request(context.server)
        .post(expensePath(created.body.id, '/pay'))
        .set(...auth(owner))
        .send({})
        .expect(409);

      expect(await ledgerCount()).toBe(0);
    });
  });

  // ----------------------------------------------------- §39 separation of duties

  describe('§39/§63 — separation of duties', () => {
    it('refuses self-approval even when the actor holds both permissions', async () => {
      const created = await createExpense();
      await request(context.server)
        .post(expensePath(created.body.id, '/submit'))
        .set(...auth(owner))
        .expect(201);

      // The owner is an org admin holding BOTH create and approve. The
      // permission matrix cannot catch this — only the service check can.
      await request(context.server)
        .post(expensePath(created.body.id, '/approve'))
        .set(...auth(owner))
        .expect(403);

      const stored = await context.prisma.expense.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      expect(stored.status).toBe('SUBMITTED');
      expect(stored.approvedByPersonId).toBeNull();
    });

    it('rejects with a mandatory reason and keeps it on the row', async () => {
      const created = await createExpense();
      await request(context.server)
        .post(expensePath(created.body.id, '/submit'))
        .set(...auth(owner))
        .expect(201);

      const approver = await addApprover();

      // A refusal with no reason is not a decision anyone can act on.
      await request(context.server)
        .post(expensePath(created.body.id, '/reject'))
        .set(...auth(approver))
        .send({ reason: '  ' })
        .expect(400);

      const rejected = await request(context.server)
        .post(expensePath(created.body.id, '/reject'))
        .set(...auth(approver))
        .send({ reason: 'فاکتور فاقد مهر شرکت است' })
        .expect(201);

      expect(rejected.body.status).toBe('REJECTED');
      expect(rejected.body.decisionReason).toBe('فاکتور فاقد مهر شرکت است');
      expect(await ledgerCount()).toBe(0);
    });

    it('keeps CANCELLED distinct from REJECTED', async () => {
      const created = await createExpense();

      const cancelled = await request(context.server)
        .post(expensePath(created.body.id, '/cancel'))
        .set(...auth(owner))
        .expect(201);

      // Withdrawn by the requester, not refused by an approver. A building
      // arguing with a contractor needs to tell those apart.
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.decisionReason).toBeNull();
    });

    it('refuses to cancel an expense whose money already left', async () => {
      await openPeriod();
      const expenseId = await approvedExpense(12000000);
      await request(context.server)
        .post(expensePath(expenseId, '/pay'))
        .set(...auth(owner))
        .send({})
        .expect(201);

      // §70 — a transaction is never deleted. The correction is a reversal.
      await request(context.server)
        .post(expensePath(expenseId, '/cancel'))
        .set(...auth(owner))
        .expect(409);

      expect(await ledgerCount()).toBe(1);
    });
  });

  // ------------------------------------------------------------ §38 duplicates

  describe('§38 — the same supplier invoice is not paid twice', () => {
    it('refuses a duplicate vendor + invoice reference', async () => {
      const invoiceReference = unique('INV-');

      await createExpense({ invoiceReference });
      await createExpense({ invoiceReference }, 409);

      const count = await context.prisma.expense.count({ where: { buildingId } });
      expect(count).toBe(1);
    });

    it('allows repeat entries with no document number', async () => {
      // Postgres treats NULLs as distinct, so an expense with no reference yet
      // is deliberately unconstrained — two genuine cash purchases from the same
      // vendor are not a duplicate.
      await createExpense();
      await createExpense();

      const count = await context.prisma.expense.count({ where: { buildingId } });
      expect(count).toBe(2);
    });

    it('refuses edits once the expense has been submitted', async () => {
      const created = await createExpense();

      await request(context.server)
        .patch(expensePath(created.body.id))
        .set(...auth(owner))
        .send({ amount: 9000000 })
        .expect(200);

      await request(context.server)
        .post(expensePath(created.body.id, '/submit'))
        .set(...auth(owner))
        .expect(201);

      // An approver reviewed specific figures; letting them move afterwards
      // makes the approval meaningless.
      await request(context.server)
        .patch(expensePath(created.body.id))
        .set(...auth(owner))
        .send({ amount: 99000000 })
        .expect(409);
    });
  });

  // ---------------------------------------------------------------- §41 income

  describe('§41 — income recorded outside the charge pipeline', () => {
    it('credits the building immediately with no approval step', async () => {
      await openPeriod();
      const categoryId = await createCategory('INCOME');

      const recorded = await request(context.server)
        .post(`/api/buildings/${buildingId}/incomes`)
        .set(...auth(owner))
        .send({
          categoryId,
          amount: 3000000,
          receivedAt: '2025-09-20T00:00:00.000Z',
          sourceType: 'RENTAL',
          description: 'اجاره آنتن پشت‌بام',
        })
        .expect(201);

      expect(recorded.body.ledgerEntryId).not.toBeNull();

      const entry = await context.prisma.ledgerEntry.findUniqueOrThrow({
        where: { id: recorded.body.ledgerEntryId },
      });
      expect(entry.direction).toBe('CREDIT');
      expect(entry.referenceType).toBe('INCOME');
      expect(Number(entry.amount)).toBe(3000000);
      // Building-level: the antenna rent belongs to the building, and crediting
      // a unit here would reduce that resident's charge obligation by it.
      expect(entry.unitId).toBeNull();
    });

    it('refuses income filed under an expense category', async () => {
      await openPeriod();
      const expenseCategory = await createCategory('EXPENSE');

      await request(context.server)
        .post(`/api/buildings/${buildingId}/incomes`)
        .set(...auth(owner))
        .send({
          categoryId: expenseCategory,
          amount: 3000000,
          receivedAt: '2025-09-20T00:00:00.000Z',
          sourceType: 'RENTAL',
          description: 'اجاره',
        })
        .expect(409);

      expect(await ledgerCount()).toBe(0);
    });

    it('offers no way to file charge income here', async () => {
      await openPeriod();
      const categoryId = await createCategory('INCOME');

      // CHARGE is absent from IncomeSourceType by design: charge income already
      // reaches the books through Charge → Invoice → Payment, and mirroring it
      // here would count the same rial twice in every report.
      await request(context.server)
        .post(`/api/buildings/${buildingId}/incomes`)
        .set(...auth(owner))
        .send({
          categoryId,
          amount: 3000000,
          receivedAt: '2025-09-20T00:00:00.000Z',
          sourceType: 'CHARGE',
          description: 'شارژ ماهانه',
        })
        .expect(400);

      expect(await ledgerCount()).toBe(0);
    });
  });

  // -------------------------------------------------------------- §53 summary

  describe('§53 — the manager dashboard', () => {
    it('reports collected income, paid expenses and pending commitments apart', async () => {
      await openPeriod();

      const incomeCategory = await createCategory('INCOME');
      await request(context.server)
        .post(`/api/buildings/${buildingId}/incomes`)
        .set(...auth(owner))
        .send({
          categoryId: incomeCategory,
          amount: 20000000,
          receivedAt: '2025-09-20T00:00:00.000Z',
          sourceType: 'RENTAL',
          description: 'اجاره آنتن',
        })
        .expect(201);

      const paidId = await approvedExpense(12000000);
      await request(context.server)
        .post(expensePath(paidId, '/pay'))
        .set(...auth(owner))
        .send({})
        .expect(201);

      // A second expense approved but NOT paid.
      const pendingId = await approvedExpense(5000000);

      const summary = await request(context.server)
        .get(`/api/buildings/${buildingId}/financial-summary`)
        .set(...auth(owner))
        .expect(200);

      expect(summary.body.incomeTotal).toBe(20000000);
      // Only PAID counts as spent — money that has not left the account has not
      // been spent.
      expect(summary.body.expenseTotal).toBe(12000000);
      expect(summary.body.netPosition).toBe(8000000);
      // Reported separately and deliberately NOT subtracted: it is committed
      // money the manager must see coming, but it is still in the account.
      expect(summary.body.pendingExpenseTotal).toBe(5000000);
      expect(summary.body.expenseCountByStatus.PAID).toBe(1);
      expect(summary.body.expenseCountByStatus.APPROVED).toBe(1);

      expect(pendingId).toBeDefined();
    });

    it('keeps resident debt out of the building expense figures', async () => {
      await openPeriod();
      const paidId = await approvedExpense(12000000);
      await request(context.server)
        .post(expensePath(paidId, '/pay'))
        .set(...auth(owner))
        .send({})
        .expect(201);

      const summary = await request(context.server)
        .get(`/api/buildings/${buildingId}/financial-summary`)
        .set(...auth(owner))
        .expect(200);

      // outstandingReceivable sums UNIT entries only. A paid supplier bill
      // masquerading as resident debt is precisely the number a manager would
      // then chase people for.
      expect(summary.body.outstandingReceivable).toBe(0);
      expect(summary.body.unpaidUnitCount).toBe(0);
    });
  });

  // --------------------------------------------------------- §10/§64 refusals

  describe('states and scopes that refuse an expense', () => {
    it('refuses to pay into a closed period', async () => {
      const period = await openPeriod();
      const expenseId = await approvedExpense(12000000);

      await request(context.server)
        .post(`/api/buildings/${buildingId}/financial-periods/${period.id}/close`)
        .set(...auth(owner))
        .send({ note: 'بستن دوره' })
        .expect(201);

      // §10 — a sealed month does not move retroactively.
      await request(context.server)
        .post(expensePath(expenseId, '/pay'))
        .set(...auth(owner))
        .send({ financialPeriodId: period.id })
        .expect(409);

      expect(await ledgerCount()).toBe(0);
    });

    it("refuses to read or pay another building's expense", async () => {
      await openPeriod();
      const expenseId = await approvedExpense(12000000);

      const stranger = await registerActor(context.server, 'exp-stranger');
      const strangerOrg = await createOrganization(context.server, stranger);
      const strangerBuilding = await createBuilding(
        context.server,
        stranger,
        strangerOrg,
      );

      await request(context.server)
        .get(expensePath(expenseId, '', strangerBuilding.id))
        .set(...auth(stranger))
        .expect(404);

      await request(context.server)
        .post(expensePath(expenseId, '/pay', strangerBuilding.id))
        .set(...auth(stranger))
        .send({})
        .expect(404);

      expect(await ledgerCount()).toBe(0);
    });

    it('refuses an expense with a non-positive amount', async () => {
      // Direction carries the sign in this domain; a negative expense would let
      // the same effect be expressed two ways and make every aggregate
      // ambiguous.
      await createExpense({ amount: 0 }, 400);
      await createExpense({ amount: -5000 }, 400);
    });
  });
});
