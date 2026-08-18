/**
 * Management terms — BM-00 rule 1 ("the building is permanent, the manager is
 * temporary") proven against a real Postgres, over real HTTP.
 *
 * WHAT THIS SUITE IS ACTUALLY FOR. Every other layer can only *claim* that
 * manager authority expires with its term. The claim is only worth something if
 * closing a term genuinely strips the permissions a guard reads on the NEXT
 * request — so the central tests here do not assert on a status field, they
 * re-issue a privileged call afterwards and require it to be refused.
 *
 * The three properties under test:
 *   1. A building may have at most ONE governing term at any instant, and the
 *      DB exclusion constraint — not just the service check — is what holds
 *      under a race.
 *   2. Authority is granted and revoked BY the term, transactionally.
 *   3. A closed term is immutable; history is never rewritten (R2).
 */
import request from 'supertest';
import type { Server } from 'node:http';

import {
  closeTestApp,
  createTestApp,
  resetDatabase,
  type TestContext,
} from './harness';
import {
  auth,
  createBuilding,
  createOrganization,
  createUnit,
  inviteAndAccept,
  registerActor,
  type Actor,
  type BuildingFixture,
} from './actors';

jest.setTimeout(180_000);

/** Fixed offsets keep every interval well clear of "now" and of each other. */
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number): string =>
  new Date(Date.now() + offsetDays * DAY).toISOString();

describe('Management terms (BM-01 §25/§26, BM-00 rule 1)', () => {
  let context: TestContext;
  let server: Server;

  /** ORG_OWNER — holds TERM_CREATE and TERM_TERMINATE. */
  let owner: Actor;
  /** A resident who will be appointed manager. */
  let resident: Actor;
  let building: BuildingFixture;

  beforeAll(async () => {
    context = await createTestApp();
    server = context.server;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);

    owner = await registerActor(server, 'owner');
    const organizationId = await createOrganization(server, owner);
    building = await createBuilding(server, owner, organizationId);

    resident = await registerActor(server, 'resident');
    const unitId = await createUnit(server, owner, building.id);
    await inviteAndAccept(server, owner, resident, {
      buildingId: building.id,
      role: 'OWNER',
      unitId,
    });
  });

  const termsUrl = () => `/api/buildings/${building.id}/management-terms`;

  /** Schedules a term and returns its response body. */
  async function schedule(
    body: Record<string, unknown> = {},
    expectStatus = 201,
  ): Promise<Record<string, unknown>> {
    const response = await request(server)
      .post(termsUrl())
      .set(...auth(owner))
      .send({ startsAt: iso(1), ...body })
      .expect(expectStatus);
    return response.body as Record<string, unknown>;
  }

  // -------------------------------------------------------------------------
  //  scheduling
  // -------------------------------------------------------------------------

  describe('scheduling', () => {
    it('creates a term as SCHEDULED, never immediately ACTIVE', async () => {
      const term = await schedule({ title: 'دوره اول' });

      // Electing a board and that board taking office are two events; §26
      // requires the gap between them to be representable.
      expect(term.status).toBe('SCHEDULED');
      expect(term.isCurrent).toBe(false);
      expect(term.termNumber).toBe(1);
      expect(term.title).toBe('دوره اول');
    });

    it('assigns termNumber server-side, ignoring any client-supplied value', async () => {
      // forbidNonWhitelisted means a fabricated termNumber is rejected outright
      // rather than silently honoured — a client must not be able to make a
      // later term look like it predates the first one.
      await request(server)
        .post(termsUrl())
        .set(...auth(owner))
        .send({ startsAt: iso(1), termNumber: 99 })
        .expect(400);

      const first = await schedule({ startsAt: iso(1), endsAt: iso(10) });
      const second = await schedule({ startsAt: iso(10), endsAt: iso(20) });

      expect(first.termNumber).toBe(1);
      expect(second.termNumber).toBe(2);
    });

    it('rejects a body that names its own building', async () => {
      // The tenant comes from the proven scope. A body that could name a
      // building would let a manager of A schedule themselves a term on B.
      await request(server)
        .post(termsUrl())
        .set(...auth(owner))
        .send({ startsAt: iso(1), buildingId: building.id })
        .expect(400);
    });

    it('rejects a period that ends before it starts', async () => {
      await request(server)
        .post(termsUrl())
        .set(...auth(owner))
        .send({ startsAt: iso(10), endsAt: iso(5) })
        .expect(400);
    });

    it('refuses to appoint someone who is not a member of the building', async () => {
      const stranger = await registerActor(server, 'stranger');

      const response = await request(server)
        .post(termsUrl())
        .set(...auth(owner))
        .send({ startsAt: iso(1), managerPersonId: stranger.personId })
        .expect(409);

      // Persian, and specific: a generic conflict would leave the operator
      // guessing which of several rules they hit.
      expect(String(response.body.message)).toContain('عضو');
    });
  });

  // -------------------------------------------------------------------------
  //  the overlap rule — at most one governing term per building
  // -------------------------------------------------------------------------

  describe('at most one governing term (rule 1)', () => {
    it('rejects a second term whose interval overlaps a scheduled one', async () => {
      await schedule({ startsAt: iso(1), endsAt: iso(30) });

      const response = await request(server)
        .post(termsUrl())
        .set(...auth(owner))
        .send({ startsAt: iso(15), endsAt: iso(45) })
        .expect(409);

      expect(String(response.body.message)).toContain('هم‌پوشانی');
    });

    it('ACCEPTS a term that starts exactly when the previous one ends', async () => {
      // Half-open [start, end): without this, every clean handover would be
      // rejected as an overlap. This test is the reason the constraint uses
      // '[)' rather than '[]'.
      await schedule({ startsAt: iso(1), endsAt: iso(30) });
      const next = await schedule({ startsAt: iso(30), endsAt: iso(60) });

      expect(next.termNumber).toBe(2);
    });

    it('rejects a new term that overlaps an OPEN-ENDED one', async () => {
      await schedule({ startsAt: iso(1) });

      await request(server)
        .post(termsUrl())
        .set(...auth(owner))
        .send({ startsAt: iso(100), endsAt: iso(200) })
        .expect(409);
    });

    it('survives concurrent creates — the DB constraints, not the service check', async () => {
      // All three requests read the table before any of them writes, so the
      // application-level overlap check passes for every one. Only the database
      // can reject the losers, and it does so through EITHER the overlap
      // EXCLUDE constraint or the unique index on (buildingId, termNumber) —
      // whichever the engine evaluates first. Both are the same event to a
      // user, and both must surface as a readable 409.
      const attempt = () =>
        request(server)
          .post(termsUrl())
          .set(...auth(owner))
          .send({ startsAt: iso(1), endsAt: iso(30) });

      const results = await Promise.all([attempt(), attempt(), attempt()]);
      const created = results.filter((r) => r.status === 201);

      // Exactly one winner: if this ever exceeds 1 the constraints were
      // dropped and the service check alone is a read-then-write race.
      expect(created).toHaveLength(1);

      // NO 500s. This is the real assertion — the original version of this
      // test asserted "exactly two 409s" and passed only because the losers
      // happened to fail on the overlap constraint that run. Under load they
      // failed on the unique index instead and returned 500, which a
      // status-code-count assertion would have called a pass on a different day.
      const losers = results.filter((r) => r.status !== 201);
      expect(losers).toHaveLength(2);
      for (const response of losers) {
        expect(response.status).toBe(409);
        expect(String(response.body.message)).toContain('هم‌پوشانی');
      }

      // And exactly one row landed — the losers rolled back cleanly.
      const stored = await context.prisma.managementTerm.count({
        where: { buildingId: building.id },
      });
      expect(stored).toBe(1);
    });

    it('refuses to activate while another term governs, unless told explicitly', async () => {
      const first = await schedule({ startsAt: iso(-10), endsAt: iso(10) });
      await request(server)
        .post(`${termsUrl()}/${first.id}/activate`)
        .set(...auth(owner))
        .send({})
        .expect(200);

      const second = await schedule({ startsAt: iso(20), endsAt: iso(40) });

      const refused = await request(server)
        .post(`${termsUrl()}/${second.id}/activate`)
        .set(...auth(owner))
        .send({})
        .expect(409);

      expect(String(refused.body.message)).toContain('فعال');

      // With the explicit flag the handover goes through and the outgoing term
      // is COMPLETED — the chain of custody is recorded, not silently dropped.
      const handover = await request(server)
        .post(`${termsUrl()}/${second.id}/activate`)
        .set(...auth(owner))
        .send({ closeActiveTerm: true })
        .expect(200);

      expect(handover.body.status).toBe('ACTIVE');
      expect(handover.body.previousTermId).toBe(first.id);

      const outgoing = await request(server)
        .get(`${termsUrl()}/${first.id}`)
        .set(...auth(owner))
        .expect(200);

      expect(outgoing.body.status).toBe('COMPLETED');
      expect(outgoing.body.endsAt).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  //  authority follows the term — the load-bearing tests
  // -------------------------------------------------------------------------

  describe('authority is granted and revoked by the term (rule 4)', () => {
    /** Puts `resident` in office and returns the active term id. */
    async function putResidentInOffice(): Promise<string> {
      const term = await schedule({
        startsAt: iso(-1),
        endsAt: iso(365),
        managerPersonId: resident.personId,
      });

      await request(server)
        .post(`${termsUrl()}/${term.id}/activate`)
        .set(...auth(owner))
        .send({})
        .expect(200);

      return term.id as string;
    }

    /**
     * A privileged call the resident can ONLY make as building manager.
     * OWNER does not hold UNIT_CREATE, so this is a clean probe of the grant.
     */
    const attemptManagerAction = () =>
      request(server)
        .post(`/api/buildings/${building.id}/units`)
        .set(...auth(resident))
        .send({ label: `T${Date.now().toString(36)}` });

    it('a plain resident cannot perform manager actions before any term', async () => {
      // Baseline. Without this the later "granted" assertion would prove
      // nothing — the permission might have been there all along.
      await attemptManagerAction().expect(403);
    });

    it('activating a term GRANTS manager authority on the next request', async () => {
      await putResidentInOffice();
      await attemptManagerAction().expect(201);
    });

    it('terminating a term REVOKES that authority on the next request', async () => {
      const termId = await putResidentInOffice();
      await attemptManagerAction().expect(201);

      await request(server)
        .post(`${termsUrl()}/${termId}/terminate`)
        .set(...auth(owner))
        .send({ reason: 'استعفای مدیر' })
        .expect(200);

      // THE POINT OF THE WHOLE MODULE: no nightly job ran, no role was edited
      // by hand — closing the term is what removed the authority.
      await attemptManagerAction().expect(403);
    });

    it('completing a term also revokes it, and leaves the person a resident', async () => {
      const termId = await putResidentInOffice();

      await request(server)
        .post(`${termsUrl()}/${termId}/complete`)
        .set(...auth(owner))
        .send({})
        .expect(200);

      await attemptManagerAction().expect(403);

      // Demoted, NOT removed: ending a mandate must not destroy someone's
      // membership, unit attachment or ownership history.
      const members = await request(server)
        .get(`/api/buildings/${building.id}/members`)
        .set(...auth(owner))
        .expect(200);

      const row = (members.body as Array<Record<string, unknown>>).find(
        (m) => (m.person as Record<string, unknown>).personId === resident.personId,
      );

      expect(row).toBeDefined();
      expect(row?.status).toBe('ACTIVE');
      expect(row?.role).toBe('OWNER');
      expect(row?.managementTermId).toBeNull();
      expect((row?.unitIds as string[]).length).toBeGreaterThan(0);
    });

    it('the manager cannot terminate their own term', async () => {
      const termId = await putResidentInOffice();

      // TERM_TERMINATE is deliberately withheld from BUILDING_MANAGER: an
      // officeholder who can end the term bounding their mandate — or extend
      // it — is permanent in all but name.
      await request(server)
        .post(`${termsUrl()}/${termId}/terminate`)
        .set(...auth(resident))
        .send({ reason: 'خوداستعفا' })
        .expect(403);

      await request(server)
        .post(termsUrl())
        .set(...auth(resident))
        .send({ startsAt: iso(400), endsAt: iso(700) })
        .expect(403);

      // Authority is intact — the refusals were about permission, not a
      // half-applied state change.
      await attemptManagerAction().expect(201);
    });

    it('requires a reason to terminate (R2: record why, never delete)', async () => {
      const termId = await putResidentInOffice();

      await request(server)
        .post(`${termsUrl()}/${termId}/terminate`)
        .set(...auth(owner))
        .send({})
        .expect(400);

      // And the term is untouched — a rejected request must not half-close it.
      const after = await request(server)
        .get(`${termsUrl()}/${termId}`)
        .set(...auth(owner))
        .expect(200);

      expect(after.body.status).toBe('ACTIVE');
    });
  });

  // -------------------------------------------------------------------------
  //  history is immutable (R2)
  // -------------------------------------------------------------------------

  describe('closed terms are immutable (rule 3)', () => {
    it('refuses to edit a terminated term', async () => {
      const term = await schedule({ startsAt: iso(-1), endsAt: iso(30) });
      await request(server)
        .post(`${termsUrl()}/${term.id}/activate`)
        .set(...auth(owner))
        .send({})
        .expect(200);

      await request(server)
        .post(`${termsUrl()}/${term.id}/terminate`)
        .set(...auth(owner))
        .send({ reason: 'تخلف مالی' })
        .expect(200);

      const refused = await request(server)
        .patch(`${termsUrl()}/${term.id}`)
        .set(...auth(owner))
        .send({ title: 'بازنویسی تاریخ' })
        .expect(409);

      expect(String(refused.body.message)).toContain('پایان‌یافته');
    });

    it('keeps the termination reason and dates readable afterwards', async () => {
      const term = await schedule({ startsAt: iso(-1), endsAt: iso(30) });
      await request(server)
        .post(`${termsUrl()}/${term.id}/activate`)
        .set(...auth(owner))
        .send({})
        .expect(200);
      await request(server)
        .post(`${termsUrl()}/${term.id}/terminate`)
        .set(...auth(owner))
        .send({ reason: 'تخلف مالی' })
        .expect(200);

      const stored = await request(server)
        .get(`${termsUrl()}/${term.id}`)
        .set(...auth(owner))
        .expect(200);

      // "Who governed between which dates, and why did it end" is what a later
      // dispute is settled with.
      expect(stored.body.status).toBe('TERMINATED');
      expect(stored.body.terminationReason).toBe('تخلف مالی');
      expect(stored.body.terminatedAt).not.toBeNull();
      expect(stored.body.endsAt).not.toBeNull();
    });

    it('exposes no DELETE route for terms', async () => {
      const term = await schedule();

      // 404 = the route does not exist at all. A 200/204 here would mean
      // governance history can be erased.
      await request(server)
        .delete(`${termsUrl()}/${term.id}`)
        .set(...auth(owner))
        .expect(404);
    });

    it('refuses to activate a term whose window has already passed', async () => {
      // Regression guard. Activation deliberately moves `startsAt` forward to
      // now rather than back-dating authority; on an already-expired term that
      // yields endsAt < startsAt and used to surface as a raw 500 from the
      // `management_terms_period_order` CHECK. The correct answer is a
      // governance one: schedule a new term, do not resurrect a lapsed mandate.
      const lapsed = await schedule({ startsAt: iso(-20), endsAt: iso(-10) });

      const refused = await request(server)
        .post(`${termsUrl()}/${lapsed.id}/activate`)
        .set(...auth(owner))
        .send({})
        .expect(409);

      expect(String(refused.body.message)).toContain('پایان');

      // Refused cleanly — not half-applied.
      const after = await request(server)
        .get(`${termsUrl()}/${lapsed.id}`)
        .set(...auth(owner))
        .expect(200);
      expect(after.body.status).toBe('SCHEDULED');
    });

    it('lists closed terms alongside open ones — history is the feature', async () => {
      const first = await schedule({ startsAt: iso(-20), endsAt: iso(10) });
      await request(server)
        .post(`${termsUrl()}/${first.id}/activate`)
        .set(...auth(owner))
        .send({})
        .expect(200);
      await request(server)
        .post(`${termsUrl()}/${first.id}/complete`)
        .set(...auth(owner))
        .send({})
        .expect(200);

      await schedule({ startsAt: iso(30), endsAt: iso(60) });

      const list = await request(server)
        .get(termsUrl())
        .set(...auth(owner))
        .expect(200);

      const body = list.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(2);
      // Newest first.
      expect(body[0]?.termNumber).toBe(2);
      expect(body.map((t) => t.status)).toContain('COMPLETED');
    });
  });

  // -------------------------------------------------------------------------
  //  reading
  // -------------------------------------------------------------------------

  describe('reading terms', () => {
    it('returns null from /current when no term governs', async () => {
      const response = await request(server)
        .get(`${termsUrl()}/current`)
        .set(...auth(owner))
        .expect(200);

      // A merely SCHEDULED term must not be reported as current.
      await schedule({ startsAt: iso(5), endsAt: iso(30) });
      const stillNone = await request(server)
        .get(`${termsUrl()}/current`)
        .set(...auth(owner))
        .expect(200);

      expect(response.body).toEqual({});
      expect(stillNone.body).toEqual({});
    });

    it('/current returns the governing term with its manager', async () => {
      const term = await schedule({
        startsAt: iso(-1),
        endsAt: iso(30),
        managerPersonId: resident.personId,
      });
      await request(server)
        .post(`${termsUrl()}/${term.id}/activate`)
        .set(...auth(owner))
        .send({})
        .expect(200);

      const current = await request(server)
        .get(`${termsUrl()}/current`)
        .set(...auth(owner))
        .expect(200);

      expect(current.body.id).toBe(term.id);
      expect(current.body.isCurrent).toBe(true);
      expect(current.body.manager.personId).toBe(resident.personId);
      expect(current.body.manager.buildingRole).toBe('BUILDING_MANAGER');
    });

    it('does not leak the manager\'s contact details', async () => {
      const term = await schedule({
        startsAt: iso(-1),
        managerPersonId: resident.personId,
      });
      await request(server)
        .post(`${termsUrl()}/${term.id}/activate`)
        .set(...auth(owner))
        .send({})
        .expect(200);

      const current = await request(server)
        .get(`${termsUrl()}/current`)
        .set(...auth(owner))
        .expect(200);

      // Knowing WHO manages the building is a resident's right; their phone
      // number is not part of it (BM-00 rule 6). Asserted on the serialized
      // payload so a nested leak cannot slip through.
      const serialized = JSON.stringify(current.body);
      expect(serialized).not.toContain(resident.email);
      expect(current.body.manager.email).toBeUndefined();
      expect(current.body.manager.phoneNumber).toBeUndefined();
    });

    it('a resident may read terms but not create them', async () => {
      await schedule({ startsAt: iso(1), endsAt: iso(30) });

      // TERM_READ is in RESIDENT_BASE — transparency about who governs.
      await request(server)
        .get(termsUrl())
        .set(...auth(resident))
        .expect(200);

      await request(server)
        .post(termsUrl())
        .set(...auth(resident))
        .send({ startsAt: iso(100) })
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  //  tenant isolation
  // -------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('a term id from another building is unreachable, and unchanged by the attempt', async () => {
      const outsider = await registerActor(server, 'outsider');
      const otherOrg = await createOrganization(server, outsider, 'شرکت دیگر');
      const otherBuilding = await createBuilding(server, outsider, otherOrg);

      const foreign = await request(server)
        .post(`/api/buildings/${otherBuilding.id}/management-terms`)
        .set(...auth(outsider))
        .send({ startsAt: iso(1), endsAt: iso(30), title: 'دوره همسایه' })
        .expect(201);

      // `owner` holds TERM_TERMINATE in their OWN org, so the only thing that
      // can stop them here is the tenant boundary — this is a real IDOR probe,
      // not a permission check firing early.
      await request(server)
        .post(`${termsUrl()}/${foreign.body.id}/terminate`)
        .set(...auth(owner))
        .send({ reason: 'تلاش برای دستکاری' })
        .expect(404);

      await request(server)
        .patch(`${termsUrl()}/${foreign.body.id}`)
        .set(...auth(owner))
        .send({ title: 'دستکاری‌شده' })
        .expect(404);

      // A guard that returns 404 AFTER writing is still a leak — assert the
      // row is untouched, not merely that the status code was red.
      const stored = await context.prisma.managementTerm.findUnique({
        where: { id: foreign.body.id as string },
      });

      expect(stored?.status).toBe('SCHEDULED');
      expect(stored?.title).toBe('دوره همسایه');
      expect(stored?.terminationReason).toBeNull();
    });

    it('term lists never span buildings', async () => {
      await schedule({ startsAt: iso(1), endsAt: iso(30) });

      const outsider = await registerActor(server, 'outsider2');
      const otherOrg = await createOrganization(server, outsider, 'شرکت سوم');
      const otherBuilding = await createBuilding(server, outsider, otherOrg);
      await request(server)
        .post(`/api/buildings/${otherBuilding.id}/management-terms`)
        .set(...auth(outsider))
        .send({ startsAt: iso(1), endsAt: iso(30) })
        .expect(201);

      const mine = await request(server)
        .get(termsUrl())
        .set(...auth(owner))
        .expect(200);

      const body = mine.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body.every((t) => t.buildingId === building.id)).toBe(true);
    });
  });
});
