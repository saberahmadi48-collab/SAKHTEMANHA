/**
 * Ownership & occupancy e2e — BM-01 §18/§19/§20, and the proof for §46 item 5
 * ("history survives") at the unit level.
 *
 * WHAT THIS SUITE IS ACTUALLY FOR: proving that a sale is a pair of events
 * rather than an edit, and that the resulting history is still answerable
 * afterwards. The assertions that matter therefore look at the TIMELINE — how
 * many periods exist, which one is current, what the closed one still says —
 * rather than at a single mutable field.
 *
 * Everything goes through HTTP. Nothing is seeded with Prisma: a test that
 * asserts over hand-planted rows proves nothing about the endpoints a client
 * calls.
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
} from './actors';

jest.setTimeout(120_000);

describe('ownership & occupancy (BM-01 §18/§19/§20)', () => {
  let context: TestContext;
  let server: Server;

  /** ORG_OWNER of the building — holds OWNERSHIP_MANAGE and OCCUPANCY_MANAGE. */
  let manager: Actor;
  /** A resident with the OWNER building role — holds OWNERSHIP_READ only. */
  let seller: Actor;
  let buyer: Actor;
  let tenant: Actor;

  let buildingId: string;
  let unitId: string;

  beforeAll(async () => {
    context = await createTestApp();
    server = context.server;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);

    manager = await registerActor(server, 'mgr');
    seller = await registerActor(server, 'seller');
    buyer = await registerActor(server, 'buyer');
    tenant = await registerActor(server, 'tenant');

    const organizationId = await createOrganization(server, manager);
    const building = await createBuilding(server, manager, organizationId);
    buildingId = building.id;
    unitId = await createUnit(server, manager, buildingId, 'واحد ۱۲');

    // Everyone who will hold title or live here must already be a member —
    // that rule is asserted directly further down.
    for (const [actor, role] of [
      [seller, 'OWNER'],
      [buyer, 'OWNER'],
      [tenant, 'TENANT'],
    ] as const) {
      await inviteAndAccept(server, manager, actor, { buildingId, role });
    }
  });

  // -------------------------------------------------------------------------
  //  Ownership — opening, sharing, and the rules around both
  // -------------------------------------------------------------------------

  describe('ownership basics', () => {
    it('opens a title period and reports it as current', async () => {
      const response = await request(server)
        .post(`/api/buildings/${buildingId}/ownerships`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: seller.personId,
          periodStart: '2023-01-01T00:00:00.000Z',
          titleReference: 'سند ۱۲۳',
        })
        .expect(201);

      expect(response.body.owner.personId).toBe(seller.personId);
      expect(response.body.periodEnd).toBeNull();
      expect(response.body.isCurrent).toBe(true);
      // Decimal must serialise as a NUMBER — a client doing arithmetic on
      // Prisma's {s,e,d} object shape gets NaN.
      expect(response.body.sharePercent).toBe(100);
      expect(typeof response.body.sharePercent).toBe('number');
      expect(response.body.isPrimary).toBe(true);
    });

    it('rejects a body that names its own building (tenancy comes from the URL)', async () => {
      await request(server)
        .post(`/api/buildings/${buildingId}/ownerships`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: seller.personId,
          periodStart: '2023-01-01T00:00:00.000Z',
          buildingId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
    });

    it('refuses title for someone who is not a member of the building', async () => {
      const outsider = await registerActor(server, 'outsider');

      const response = await request(server)
        .post(`/api/buildings/${buildingId}/ownerships`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: outsider.personId,
          periodStart: '2023-01-01T00:00:00.000Z',
        })
        .expect(409);

      expect(response.body.message).toContain('عضو');
    });

    it('refuses a unit that belongs to another building', async () => {
      const otherOrg = await createOrganization(server, manager, 'شرکت دوم');
      const otherBuilding = await createBuilding(server, manager, otherOrg);
      const foreignUnit = await createUnit(
        server,
        manager,
        otherBuilding.id,
        'واحد بیگانه',
      );

      await request(server)
        .post(`/api/buildings/${buildingId}/ownerships`)
        .set(...auth(manager))
        .send({
          unitId: foreignUnit,
          personId: seller.personId,
          periodStart: '2023-01-01T00:00:00.000Z',
        })
        .expect(404);
    });

    it('allows joint ownership by DIFFERENT people in the same window', async () => {
      await openOwnership(seller.personId, '2023-01-01T00:00:00.000Z', {
        sharePercent: 60,
      });
      await openOwnership(buyer.personId, '2023-01-01T00:00:00.000Z', {
        sharePercent: 40,
        isPrimary: false,
      });

      const list = await request(server)
        .get(`/api/buildings/${buildingId}/ownerships?current=true`)
        .set(...auth(manager))
        .expect(200);

      expect(list.body).toHaveLength(2);
      const total = list.body.reduce(
        (sum: number, row: { sharePercent: number }) => sum + row.sharePercent,
        0,
      );
      expect(total).toBe(100);
    });

    it('refuses shares that would take the unit past 100%', async () => {
      await openOwnership(seller.personId, '2023-01-01T00:00:00.000Z', {
        sharePercent: 60,
      });

      const response = await request(server)
        .post(`/api/buildings/${buildingId}/ownerships`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: buyer.personId,
          periodStart: '2023-01-01T00:00:00.000Z',
          sharePercent: 50,
        })
        .expect(409);

      expect(response.body.message).toContain('۱۰۰');
    });

    it('does NOT count a non-overlapping earlier period against the 100% ceiling', async () => {
      // Seller owned it fully, then sold. The buyer taking 100% afterwards is
      // not a conflict — only OVERLAPPING periods share the ceiling.
      const first = await openOwnership(
        seller.personId,
        '2020-01-01T00:00:00.000Z',
        { periodEnd: '2022-01-01T00:00:00.000Z' },
      );
      expect(first.isCurrent).toBe(false);

      await openOwnership(buyer.personId, '2022-01-01T00:00:00.000Z');
    });

    it('keeps at most one primary owner per unit', async () => {
      await openOwnership(seller.personId, '2023-01-01T00:00:00.000Z', {
        sharePercent: 50,
      });
      await openOwnership(buyer.personId, '2023-01-01T00:00:00.000Z', {
        sharePercent: 50,
        isPrimary: true,
      });

      const list = await request(server)
        .get(`/api/buildings/${buildingId}/ownerships?current=true`)
        .set(...auth(manager))
        .expect(200);

      const primaries = list.body.filter(
        (row: { isPrimary: boolean }) => row.isPrimary,
      );
      expect(primaries).toHaveLength(1);
      expect(primaries[0].owner.personId).toBe(buyer.personId);
    });

    it('rejects the SAME person holding two overlapping periods on one unit', async () => {
      await openOwnership(seller.personId, '2023-01-01T00:00:00.000Z', {
        sharePercent: 50,
      });

      const response = await request(server)
        .post(`/api/buildings/${buildingId}/ownerships`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: seller.personId,
          periodStart: '2023-06-01T00:00:00.000Z',
          sharePercent: 10,
        })
        .expect(409);

      // Must be the Persian overlap message, not a raw 500 leaking the
      // constraint name.
      expect(response.body.message).toBeTruthy();
      expect(String(response.body.message)).not.toContain('unit_ownerships');
    });
  });

  // -------------------------------------------------------------------------
  //  Transfer — the heart of R2
  // -------------------------------------------------------------------------

  describe('ownership transfer (a sale is two events, never an edit)', () => {
    it('closes the seller period and opens the buyer one atomically', async () => {
      const opened = await openOwnership(
        seller.personId,
        '2020-01-01T00:00:00.000Z',
        { titleReference: 'سند فروشنده' },
      );

      const response = await request(server)
        .post(`/api/buildings/${buildingId}/ownerships/transfer`)
        .set(...auth(manager))
        .send({
          unitId,
          toPersonId: buyer.personId,
          transferredAt: '2024-03-01T00:00:00.000Z',
          titleReference: 'سند خریدار',
        })
        .expect(200);

      expect(response.body.closed).toHaveLength(1);
      expect(response.body.closed[0].id).toBe(opened.id);
      expect(response.body.closed[0].owner.personId).toBe(seller.personId);
      expect(response.body.opened.owner.personId).toBe(buyer.personId);

      // The half-open interval is what makes a clean handover expressible:
      // the seller's period ENDS at exactly the instant the buyer's BEGINS.
      expect(response.body.closed[0].periodEnd).toBe(
        response.body.opened.periodStart,
      );
      expect(response.body.opened.periodEnd).toBeNull();
    });

    it('leaves the historical record intact and still queryable after the sale', async () => {
      await openOwnership(seller.personId, '2020-01-01T00:00:00.000Z', {
        titleReference: 'سند فروشنده',
      });

      await request(server)
        .post(`/api/buildings/${buildingId}/ownerships/transfer`)
        .set(...auth(manager))
        .send({
          unitId,
          toPersonId: buyer.personId,
          transferredAt: '2024-03-01T00:00:00.000Z',
        })
        .expect(200);

      // THE POINT OF THE WHOLE MODULE: after the sale, the question "who owned
      // this unit in 2021" is still answerable, and the seller's own record is
      // untouched.
      const all = await request(server)
        .get(`/api/buildings/${buildingId}/ownerships?unitId=${unitId}`)
        .set(...auth(manager))
        .expect(200);

      expect(all.body).toHaveLength(2);

      const sellerRow = all.body.find(
        (row: { owner: { personId: string } }) =>
          row.owner.personId === seller.personId,
      );
      expect(sellerRow.titleReference).toBe('سند فروشنده');
      expect(sellerRow.isCurrent).toBe(false);
      expect(new Date(sellerRow.periodStart).toISOString()).toBe(
        '2020-01-01T00:00:00.000Z',
      );

      const current = await request(server)
        .get(`/api/buildings/${buildingId}/ownerships?unitId=${unitId}&current=true`)
        .set(...auth(manager))
        .expect(200);

      expect(current.body).toHaveLength(1);
      expect(current.body[0].owner.personId).toBe(buyer.personId);
    });

    it('carries the outgoing total share to the buyer so the unit stays at 100%', async () => {
      await openOwnership(seller.personId, '2020-01-01T00:00:00.000Z', {
        sharePercent: 60,
      });
      await openOwnership(buyer.personId, '2020-01-01T00:00:00.000Z', {
        sharePercent: 40,
        isPrimary: false,
      });

      const third = await registerActor(server, 'third');
      await inviteAndAccept(server, manager, third, {
        buildingId,
        role: 'OWNER',
      });

      const response = await request(server)
        .post(`/api/buildings/${buildingId}/ownerships/transfer`)
        .set(...auth(manager))
        .send({
          unitId,
          toPersonId: third.personId,
          transferredAt: '2024-03-01T00:00:00.000Z',
        })
        .expect(200);

      expect(response.body.closed).toHaveLength(2);
      expect(response.body.opened.sharePercent).toBe(100);
    });

    it('refuses a transfer dated before the sitting period began', async () => {
      await openOwnership(seller.personId, '2024-01-01T00:00:00.000Z');

      await request(server)
        .post(`/api/buildings/${buildingId}/ownerships/transfer`)
        .set(...auth(manager))
        .send({
          unitId,
          toPersonId: buyer.personId,
          transferredAt: '2020-01-01T00:00:00.000Z',
        })
        .expect(400);
    });

    it('refuses a transfer to a non-member', async () => {
      await openOwnership(seller.personId, '2020-01-01T00:00:00.000Z');
      const outsider = await registerActor(server, 'outsider2');

      await request(server)
        .post(`/api/buildings/${buildingId}/ownerships/transfer`)
        .set(...auth(manager))
        .send({
          unitId,
          toPersonId: outsider.personId,
          transferredAt: '2024-03-01T00:00:00.000Z',
        })
        .expect(409);
    });
  });

  // -------------------------------------------------------------------------
  //  Immutability of closed history (R2)
  // -------------------------------------------------------------------------

  describe('closed periods are immutable', () => {
    it('refuses to edit a closed ownership period', async () => {
      await openOwnership(seller.personId, '2020-01-01T00:00:00.000Z');

      const transfer = await request(server)
        .post(`/api/buildings/${buildingId}/ownerships/transfer`)
        .set(...auth(manager))
        .send({
          unitId,
          toPersonId: buyer.personId,
          transferredAt: '2024-03-01T00:00:00.000Z',
        })
        .expect(200);

      const closedId = transfer.body.closed[0].id as string;

      await request(server)
        .patch(`/api/buildings/${buildingId}/ownerships/${closedId}`)
        .set(...auth(manager))
        .send({ sharePercent: 10 })
        .expect(409);
    });

    it('refuses to close an already-closed period twice', async () => {
      const opened = await openOwnership(
        seller.personId,
        '2020-01-01T00:00:00.000Z',
      );

      await request(server)
        .post(`/api/buildings/${buildingId}/ownerships/${opened.id}/close`)
        .set(...auth(manager))
        .send({ endedAt: '2024-01-01T00:00:00.000Z', reason: 'فروش' })
        .expect(200);

      await request(server)
        .post(`/api/buildings/${buildingId}/ownerships/${opened.id}/close`)
        .set(...auth(manager))
        .send({ endedAt: '2024-06-01T00:00:00.000Z' })
        .expect(409);
    });

    it('offers no DELETE route at all', async () => {
      const opened = await openOwnership(
        seller.personId,
        '2020-01-01T00:00:00.000Z',
      );

      await request(server)
        .delete(`/api/buildings/${buildingId}/ownerships/${opened.id}`)
        .set(...auth(manager))
        .expect(404);
    });

    it('appends the closing reason instead of overwriting existing notes', async () => {
      const opened = await openOwnership(
        seller.personId,
        '2020-01-01T00:00:00.000Z',
        { notes: 'یادداشت اولیه' },
      );

      const closed = await request(server)
        .post(`/api/buildings/${buildingId}/ownerships/${opened.id}/close`)
        .set(...auth(manager))
        .send({ endedAt: '2024-01-01T00:00:00.000Z', reason: 'فروش قطعی' })
        .expect(200);

      expect(closed.body.notes).toContain('یادداشت اولیه');
      expect(closed.body.notes).toContain('فروش قطعی');
    });
  });

  // -------------------------------------------------------------------------
  //  Authorization — who may read, who may write
  // -------------------------------------------------------------------------

  describe('authorization', () => {
    it('lets an OWNER read ownership but not write it', async () => {
      await openOwnership(seller.personId, '2020-01-01T00:00:00.000Z');

      await request(server)
        .get(`/api/buildings/${buildingId}/ownerships`)
        .set(...auth(seller))
        .expect(200);

      // Recording a sale is a registry act — not something an owner performs
      // on their own record.
      await request(server)
        .post(`/api/buildings/${buildingId}/ownerships`)
        .set(...auth(seller))
        .send({
          unitId,
          personId: seller.personId,
          periodStart: '2025-01-01T00:00:00.000Z',
        })
        .expect(403);
    });

    it('denies a TENANT the occupancy directory (BM-00 rule 6)', async () => {
      // The asymmetry with ownership is deliberate: a register of who
      // physically lives where is the surveillance surface rule 6 guards.
      await request(server)
        .get(`/api/buildings/${buildingId}/occupancies`)
        .set(...auth(tenant))
        .expect(403);
    });

    it('refuses an outsider entirely', async () => {
      const outsider = await registerActor(server, 'outsider3');

      await request(server)
        .get(`/api/buildings/${buildingId}/ownerships`)
        .set(...auth(outsider))
        .expect(403);
    });

    it('does not leak an ownership row across buildings', async () => {
      const opened = await openOwnership(
        seller.personId,
        '2020-01-01T00:00:00.000Z',
      );

      const otherManager = await registerActor(server, 'mgr2');
      const otherOrg = await createOrganization(server, otherManager, 'شرکت رقیب');
      const otherBuilding = await createBuilding(server, otherManager, otherOrg);

      // Reading a foreign id through one's OWN building must be a 404, not a
      // 403 — a 403 would confirm the row exists and permit enumeration.
      await request(server)
        .get(`/api/buildings/${otherBuilding.id}/ownerships/${opened.id}`)
        .set(...auth(otherManager))
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  //  Occupancy — the stricter timeline
  // -------------------------------------------------------------------------

  describe('occupancy', () => {
    it('opens an occupancy period for a tenant', async () => {
      const response = await request(server)
        .post(`/api/buildings/${buildingId}/occupancies`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: tenant.personId,
          kind: 'TENANT',
          periodStart: '2023-01-01T00:00:00.000Z',
          residentCount: 3,
          leaseReference: 'اجاره‌نامه ۹',
        })
        .expect(201);

      expect(response.body.occupant.personId).toBe(tenant.personId);
      expect(response.body.kind).toBe('TENANT');
      expect(response.body.residentCount).toBe(3);
      expect(response.body.isCurrent).toBe(true);
    });

    it('requires a person for every kind except VACANT', async () => {
      const response = await request(server)
        .post(`/api/buildings/${buildingId}/occupancies`)
        .set(...auth(manager))
        .send({
          unitId,
          kind: 'TENANT',
          periodStart: '2023-01-01T00:00:00.000Z',
        })
        .expect(400);

      expect(response.body.message).toContain('ساکن');
    });

    it('forbids a person on a VACANT period', async () => {
      const response = await request(server)
        .post(`/api/buildings/${buildingId}/occupancies`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: tenant.personId,
          kind: 'VACANT',
          periodStart: '2023-01-01T00:00:00.000Z',
        })
        .expect(400);

      expect(response.body.message).toContain('خالی');
    });

    it('allows a VACANT period with no person and zero residents', async () => {
      const response = await request(server)
        .post(`/api/buildings/${buildingId}/occupancies`)
        .set(...auth(manager))
        .send({
          unitId,
          kind: 'VACANT',
          periodStart: '2023-01-01T00:00:00.000Z',
        })
        .expect(201);

      expect(response.body.occupant).toBeNull();
      expect(response.body.residentCount).toBe(0);
    });

    it('refuses TWO overlapping occupancies on one unit, even for different people', async () => {
      await request(server)
        .post(`/api/buildings/${buildingId}/occupancies`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: tenant.personId,
          kind: 'TENANT',
          periodStart: '2023-01-01T00:00:00.000Z',
        })
        .expect(201);

      // This is the deliberate difference from ownership: joint TITLE is
      // legitimate, joint physical occupancy of the same instant is not.
      const response = await request(server)
        .post(`/api/buildings/${buildingId}/occupancies`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: seller.personId,
          kind: 'OWNER_OCCUPIED',
          periodStart: '2023-06-01T00:00:00.000Z',
        })
        .expect(409);

      expect(String(response.body.message)).not.toContain('unit_occupancies');
    });

    it('moves a new occupant in and closes the previous period at the same instant', async () => {
      await request(server)
        .post(`/api/buildings/${buildingId}/occupancies`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: seller.personId,
          kind: 'OWNER_OCCUPIED',
          periodStart: '2020-01-01T00:00:00.000Z',
        })
        .expect(201);

      const response = await request(server)
        .post(`/api/buildings/${buildingId}/occupancies/move-in`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: tenant.personId,
          kind: 'TENANT',
          movedInAt: '2024-03-01T00:00:00.000Z',
          residentCount: 2,
        })
        .expect(200);

      expect(response.body.closed.occupant.personId).toBe(seller.personId);
      expect(response.body.opened.occupant.personId).toBe(tenant.personId);
      expect(response.body.closed.periodEnd).toBe(
        response.body.opened.periodStart,
      );

      // Exactly one current occupancy — no gap, no double occupancy.
      const current = await request(server)
        .get(`/api/buildings/${buildingId}/occupancies?unitId=${unitId}&current=true`)
        .set(...auth(manager))
        .expect(200);

      expect(current.body).toHaveLength(1);
      expect(current.body[0].occupant.personId).toBe(tenant.personId);
    });

    it('opens a VACANT period on move-out when asked', async () => {
      const opened = await request(server)
        .post(`/api/buildings/${buildingId}/occupancies`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: tenant.personId,
          kind: 'TENANT',
          periodStart: '2020-01-01T00:00:00.000Z',
        })
        .expect(201);

      await request(server)
        .post(
          `/api/buildings/${buildingId}/occupancies/${opened.body.id}/move-out`,
        )
        .set(...auth(manager))
        .send({
          movedOutAt: '2024-03-01T00:00:00.000Z',
          leaveVacant: true,
          reason: 'پایان اجاره',
        })
        .expect(200);

      const current = await request(server)
        .get(`/api/buildings/${buildingId}/occupancies?unitId=${unitId}&current=true`)
        .set(...auth(manager))
        .expect(200);

      expect(current.body).toHaveLength(1);
      expect(current.body[0].kind).toBe('VACANT');
      expect(current.body[0].occupant).toBeNull();
    });

    it('leaves NO vacancy behind by default', async () => {
      const opened = await request(server)
        .post(`/api/buildings/${buildingId}/occupancies`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: tenant.personId,
          kind: 'TENANT',
          periodStart: '2020-01-01T00:00:00.000Z',
        })
        .expect(201);

      await request(server)
        .post(
          `/api/buildings/${buildingId}/occupancies/${opened.body.id}/move-out`,
        )
        .set(...auth(manager))
        .send({ movedOutAt: '2024-03-01T00:00:00.000Z' })
        .expect(200);

      const current = await request(server)
        .get(`/api/buildings/${buildingId}/occupancies?unitId=${unitId}&current=true`)
        .set(...auth(manager))
        .expect(200);

      expect(current.body).toHaveLength(0);
    });

    it('refuses to edit a closed occupancy period', async () => {
      const opened = await request(server)
        .post(`/api/buildings/${buildingId}/occupancies`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: tenant.personId,
          kind: 'TENANT',
          periodStart: '2020-01-01T00:00:00.000Z',
        })
        .expect(201);

      await request(server)
        .post(
          `/api/buildings/${buildingId}/occupancies/${opened.body.id}/move-out`,
        )
        .set(...auth(manager))
        .send({ movedOutAt: '2024-03-01T00:00:00.000Z' })
        .expect(200);

      await request(server)
        .patch(`/api/buildings/${buildingId}/occupancies/${opened.body.id}`)
        .set(...auth(manager))
        .send({ residentCount: 9 })
        .expect(409);
    });

    it('refuses to switch an occupied period to VACANT without clearing the occupant', async () => {
      const opened = await request(server)
        .post(`/api/buildings/${buildingId}/occupancies`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: tenant.personId,
          kind: 'TENANT',
          periodStart: '2020-01-01T00:00:00.000Z',
        })
        .expect(201);

      // Would otherwise reach the DB and fail the person_matches_kind CHECK
      // as an opaque 500.
      await request(server)
        .patch(`/api/buildings/${buildingId}/occupancies/${opened.body.id}`)
        .set(...auth(manager))
        .send({ kind: 'VACANT' })
        .expect(400);
    });

    it('keeps the occupancy history after a move-out', async () => {
      const opened = await request(server)
        .post(`/api/buildings/${buildingId}/occupancies`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: tenant.personId,
          kind: 'TENANT',
          periodStart: '2020-01-01T00:00:00.000Z',
          leaseReference: 'اجاره‌نامه ۱',
        })
        .expect(201);

      await request(server)
        .post(
          `/api/buildings/${buildingId}/occupancies/${opened.body.id}/move-out`,
        )
        .set(...auth(manager))
        .send({ movedOutAt: '2024-03-01T00:00:00.000Z' })
        .expect(200);

      const all = await request(server)
        .get(`/api/buildings/${buildingId}/occupancies?unitId=${unitId}`)
        .set(...auth(manager))
        .expect(200);

      expect(all.body).toHaveLength(1);
      expect(all.body[0].leaseReference).toBe('اجاره‌نامه ۱');
      expect(all.body[0].isCurrent).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  //  Concurrency — the property no application-level check can provide
  // -------------------------------------------------------------------------

  describe('concurrency', () => {
    it('never lets simultaneous writes push a unit past 100% ownership', async () => {
      // Two 60% claims fired together. Without the FOR UPDATE lock in
      // assertShareFits both read a total of 0, both pass, and the unit ends up
      // 120% owned — a split the ledger cannot reconcile.
      const results = await Promise.allSettled([
        request(server)
          .post(`/api/buildings/${buildingId}/ownerships`)
          .set(...auth(manager))
          .send({
            unitId,
            personId: seller.personId,
            periodStart: '2023-01-01T00:00:00.000Z',
            sharePercent: 60,
          }),
        request(server)
          .post(`/api/buildings/${buildingId}/ownerships`)
          .set(...auth(manager))
          .send({
            unitId,
            personId: buyer.personId,
            periodStart: '2023-01-01T00:00:00.000Z',
            sharePercent: 60,
          }),
      ]);

      const statuses = results.map((result) =>
        result.status === 'fulfilled' ? result.value.status : 0,
      );

      // No raw 500 may escape, whichever way the two interleave.
      expect(statuses.filter((status) => status >= 500)).toHaveLength(0);

      // The invariant that actually matters is in the data, not the codes.
      const current = await request(server)
        .get(`/api/buildings/${buildingId}/ownerships?unitId=${unitId}&current=true`)
        .set(...auth(manager))
        .expect(200);

      const total = current.body.reduce(
        (sum: number, row: { sharePercent: number }) => sum + row.sharePercent,
        0,
      );
      expect(total).toBeLessThanOrEqual(100);
    });

    it('never lets simultaneous move-ins double-occupy a unit', async () => {
      const results = await Promise.allSettled([
        request(server)
          .post(`/api/buildings/${buildingId}/occupancies/move-in`)
          .set(...auth(manager))
          .send({
            unitId,
            personId: tenant.personId,
            kind: 'TENANT',
            movedInAt: '2024-03-01T00:00:00.000Z',
          }),
        request(server)
          .post(`/api/buildings/${buildingId}/occupancies/move-in`)
          .set(...auth(manager))
          .send({
            unitId,
            personId: seller.personId,
            kind: 'OWNER_OCCUPIED',
            movedInAt: '2024-03-01T00:00:00.000Z',
          }),
      ]);

      const statuses = results.map((result) =>
        result.status === 'fulfilled' ? result.value.status : 0,
      );
      expect(statuses.filter((status) => status >= 500)).toHaveLength(0);

      const current = await request(server)
        .get(`/api/buildings/${buildingId}/occupancies?unitId=${unitId}&current=true`)
        .set(...auth(manager))
        .expect(200);

      // The EXCLUDE constraint is what guarantees this, not the app check.
      expect(current.body.length).toBeLessThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  //  helpers
  // -------------------------------------------------------------------------

  /** Opens a title period through the API and returns the created body. */
  async function openOwnership(
    personId: string,
    periodStart: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, never> & { id: string; isCurrent: boolean }> {
    const response = await request(server)
      .post(`/api/buildings/${buildingId}/ownerships`)
      .set(...auth(manager))
      .send({ unitId, personId, periodStart, ...overrides })
      .expect(201);

    return response.body;
  }
});
