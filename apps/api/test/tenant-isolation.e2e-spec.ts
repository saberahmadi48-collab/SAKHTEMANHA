/**
 * Cross-tenant isolation — BM-01 §46 item 4, the definition-of-done clause that
 * says a member of building A must be refused building B.
 *
 * THIS IS THE SUITE THAT MATTERS MOST. Everything else in BM-01 is a feature;
 * this is the property the whole multi-tenant design exists to provide. It is
 * written as an ATTACK, not as a happy path: each test takes a legitimately
 * authenticated user and points them at another tenant's resource, then asserts
 * the platform refuses.
 *
 * Two structural rules the assertions encode:
 *
 *  1. THE ANSWER IS THE SAME WHETHER OR NOT THE TARGET EXISTS. A 404 for "not
 *     yours" and a 403 for "does not exist" would let an attacker enumerate real
 *     ids by diffing status codes. ScopeService returns the same Persian message
 *     for both on purpose, and `expectsIdenticalRefusal` below proves it stays
 *     that way.
 *
 *  2. REFUSAL HAPPENS AT THE GUARD, BEFORE THE HANDLER. So a cross-tenant write
 *     must leave NO trace — the tests assert the database is unchanged, not just
 *     that the status code was red.
 */
import request from 'supertest';

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

describe('cross-tenant isolation (BM-01 §46.4)', () => {
  let context: TestContext;

  /** Tenant A: an org owner, a building, a unit, and a resident. */
  let ownerA: Actor;
  let orgA: string;
  let buildingA: BuildingFixture;
  let unitA: string;
  let residentA: Actor;

  /** Tenant B: a completely separate organization and building. */
  let ownerB: Actor;
  let orgB: string;
  let buildingB: BuildingFixture;
  let unitB: string;

  /** An authenticated account with no tenancy at all. */
  let outsider: Actor;

  beforeAll(async () => {
    context = await createTestApp();
    await resetDatabase(context.prisma);

    ownerA = await registerActor(context.server, 'ownerA');
    orgA = await createOrganization(context.server, ownerA, 'سازمان الف');
    buildingA = await createBuilding(context.server, ownerA, orgA);
    unitA = await createUnit(context.server, ownerA, buildingA.id, '101');

    ownerB = await registerActor(context.server, 'ownerB');
    orgB = await createOrganization(context.server, ownerB, 'سازمان ب');
    buildingB = await createBuilding(context.server, ownerB, orgB);
    unitB = await createUnit(context.server, ownerB, buildingB.id, '201');

    // A real resident of building A, created the only way the platform allows.
    residentA = await registerActor(context.server, 'residentA');
    await inviteAndAccept(context.server, ownerA, residentA, {
      buildingId: buildingA.id,
      role: 'OWNER',
      unitId: unitA,
    });

    outsider = await registerActor(context.server, 'outsider');
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  // -------------------------------------------------------------------------
  //  The headline requirement: §31's "GET /api/buildings/B/units → 403"
  // -------------------------------------------------------------------------

  describe('a member of building A cannot reach building B', () => {
    it('refuses the unit list of another tenant building', async () => {
      const response = await request(context.server)
        .get(`/api/buildings/${buildingB.id}/units`)
        .set(...auth(residentA));

      expect(response.status).toBe(403);
      expect(String(response.body.message)).toMatch(/[\u0600-\u06FF]/);
    });

    it('refuses the building profile of another tenant', async () => {
      await request(context.server)
        .get(`/api/buildings/${buildingB.id}`)
        .set(...auth(residentA))
        .expect(403);
    });

    it('refuses the member directory of another tenant', async () => {
      await request(context.server)
        .get(`/api/buildings/${buildingB.id}/members`)
        .set(...auth(residentA))
        .expect(403);
    });

    it('refuses a WRITE into another tenant building, and writes nothing', async () => {
      const before = await context.prisma.unit.count({
        where: { buildingId: buildingB.id },
      });

      await request(context.server)
        .post(`/api/buildings/${buildingB.id}/units`)
        .set(...auth(residentA))
        .send({ label: 'نفوذی' })
        .expect(403);

      const after = await context.prisma.unit.count({
        where: { buildingId: buildingB.id },
      });

      // The point of asserting on the database rather than the status code:
      // a guard that returned 403 *after* the write would still be a breach.
      expect(after).toBe(before);
    });

    it('refuses to invite someone into another tenant building', async () => {
      await request(context.server)
        .post(`/api/buildings/${buildingB.id}/invitations`)
        .set(...auth(residentA))
        .send({ role: 'TENANT', email: 'attacker@example.com' })
        .expect(403);

      const leaked = await context.prisma.invitation.count({
        where: { buildingId: buildingB.id },
      });
      expect(leaked).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  //  Direct-object reference: guessing a real id from another tenant
  // -------------------------------------------------------------------------

  describe('IDOR: a real id from another tenant is not a key', () => {
    it('refuses tenant B\'s unit id even though the id is genuine', async () => {
      // unitB EXISTS. The only thing wrong with this request is who is asking,
      // which is precisely the BOLA case §39 requires protection against.
      // ownerA holds UNIT_READ everywhere in their own org, so this is the
      // isolation layer answering, not the permission layer.
      await request(context.server)
        .get(`/api/buildings/${buildingA.id}/units/${unitB}`)
        .set(...auth(ownerA))
        .expect(404);
    });

    it('refuses to mutate tenant B\'s unit through tenant A\'s building path', async () => {
      const before = await context.prisma.unit.findUnique({
        where: { id: unitB },
        select: { label: true },
      });

      // ownerA is used rather than residentA ON PURPOSE. residentA lacks
      // UNIT_UPDATE, so the permission check would refuse first and the test
      // would prove nothing about isolation. ownerA HOLDS UNIT_UPDATE in their
      // own tenant, so the only thing that can stop this request is the tenant
      // boundary itself — which is what we are actually testing.
      //
      // 404, not 403: assertBelongsToScope answers "not found" for a row that
      // exists in another tenant, because "that exists but is not yours" leaks
      // the row's existence.
      await request(context.server)
        .patch(`/api/buildings/${buildingA.id}/units/${unitB}`)
        .set(...auth(ownerA))
        .send({ label: 'ربوده‌شده' })
        .expect(404);

      const after = await context.prisma.unit.findUnique({
        where: { id: unitB },
        select: { label: true },
      });

      expect(after?.label).toBe(before?.label);
    });

    it('refuses another tenant organization', async () => {
      await request(context.server)
        .get(`/api/organizations/${orgB}`)
        .set(...auth(ownerA))
        .expect(403);
    });

    it('refuses to create a building inside another tenant organization', async () => {
      const before = await context.prisma.building.count({
        where: { organizationId: orgB },
      });

      await request(context.server)
        .post(`/api/organizations/${orgB}/buildings`)
        .set(...auth(ownerA))
        .send({
          name: 'ساختمان نفوذی',
          address: { city: 'تهران', line1: 'خیابان نفوذ' },
        })
        .expect(403);

      const after = await context.prisma.building.count({
        where: { organizationId: orgB },
      });
      expect(after).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  //  Enumeration: the refusal must not reveal whether the target is real
  // -------------------------------------------------------------------------

  describe('refusals do not leak existence', () => {
    it('answers identically for a real foreign building and a non-existent one', async () => {
      const realButForeign = await request(context.server)
        .get(`/api/buildings/${buildingB.id}`)
        .set(...auth(residentA));

      const doesNotExist = await request(context.server)
        .get('/api/buildings/00000000-0000-4000-8000-000000000000')
        .set(...auth(residentA));

      // Same status AND same message. If these ever diverge, status-code
      // diffing becomes a building-id oracle.
      expect(realButForeign.status).toBe(doesNotExist.status);
      expect(realButForeign.body.message).toBe(doesNotExist.body.message);
    });

    it('rejects a malformed building id with 400 before touching the database', async () => {
      const response = await request(context.server)
        .get('/api/buildings/not-a-uuid')
        .set(...auth(residentA));

      expect(response.status).toBe(400);
      expect(String(response.body.message)).toMatch(/[\u0600-\u06FF]/);
    });
  });

  // -------------------------------------------------------------------------
  //  An authenticated account with no membership anywhere
  // -------------------------------------------------------------------------

  describe('an account with no tenancy can reach nothing', () => {
    it('sees an empty organization list', async () => {
      const response = await request(context.server)
        .get('/api/organizations')
        .set(...auth(outsider))
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('is refused both tenants', async () => {
      await request(context.server)
        .get(`/api/buildings/${buildingA.id}`)
        .set(...auth(outsider))
        .expect(403);

      await request(context.server)
        .get(`/api/buildings/${buildingB.id}`)
        .set(...auth(outsider))
        .expect(403);
    });

    it('cannot join a building merely by knowing it exists (§33)', async () => {
      // There is deliberately NO endpoint that grants membership on request.
      // Every plausible shape must fail; a 404 here means the route does not
      // exist, which is the correct answer.
      const attempts = await Promise.all([
        request(context.server)
          .post(`/api/buildings/${buildingA.id}/members`)
          .set(...auth(outsider))
          .send({ role: 'TENANT' }),
        request(context.server)
          .post(`/api/buildings/${buildingA.id}/join`)
          .set(...auth(outsider))
          .send({}),
      ]);

      for (const attempt of attempts) {
        expect(attempt.status).toBeGreaterThanOrEqual(400);
      }

      const memberships = await context.prisma.buildingMembership.count({
        where: { buildingId: buildingA.id, personId: outsider.personId },
      });
      expect(memberships).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  //  Body-smuggled tenancy (BM-00 rule 8 / §40)
  // -------------------------------------------------------------------------

  describe('tenancy cannot be smuggled through the request body', () => {
    it('rejects a buildingId in a unit-creation body', async () => {
      const before = await context.prisma.unit.count({
        where: { buildingId: buildingB.id },
      });

      // forbidNonWhitelisted turns the smuggled field into a 400 rather than
      // letting it reach a service that might spread it into a Prisma call.
      await request(context.server)
        .post(`/api/buildings/${buildingA.id}/units`)
        .set(...auth(ownerA))
        .send({ label: 'قاچاقی', buildingId: buildingB.id })
        .expect(400);

      const after = await context.prisma.unit.count({
        where: { buildingId: buildingB.id },
      });
      expect(after).toBe(before);
    });

    it('rejects an organizationId in a building-creation body', async () => {
      await request(context.server)
        .post(`/api/organizations/${orgA}/buildings`)
        .set(...auth(ownerA))
        .send({
          name: 'ساختمان با سازمان جعلی',
          organizationId: orgB,
          address: { city: 'تهران', line1: 'خیابان آزمایش قاچاق' },
        })
        .expect(400);
    });

    it('rejects a role field smuggled into registration', async () => {
      await request(context.server)
        .post('/api/auth/register')
        .send({
          email: 'privilege@example.com',
          password: 'Aparteman1394',
          firstName: 'ارتقا',
          lastName: 'خودکار',
          role: 'ORG_OWNER',
        })
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  //  Permission tiers within a tenant the caller DOES belong to
  // -------------------------------------------------------------------------

  describe('membership is not authority: permissions still apply', () => {
    it('lets the resident read their own building', async () => {
      await request(context.server)
        .get(`/api/buildings/${buildingA.id}`)
        .set(...auth(residentA))
        .expect(200);
    });

    it('refuses the same resident a manager-only write', async () => {
      // OWNER holds BUILDING_READ but not BUILDING_UPDATE — being inside the
      // tenant is necessary, never sufficient.
      const response = await request(context.server)
        .patch(`/api/buildings/${buildingA.id}`)
        .set(...auth(residentA))
        .send({ name: 'نام تغییر یافته توسط ساکن' });

      expect(response.status).toBe(403);

      const building = await context.prisma.building.findUnique({
        where: { id: buildingA.id },
        select: { name: true },
      });
      expect(building?.name).not.toBe('نام تغییر یافته توسط ساکن');
    });

    it('refuses the resident the archive permission the org tier reserves', async () => {
      await request(context.server)
        .post(`/api/buildings/${buildingA.id}/status`)
        .set(...auth(residentA))
        .send({ status: 'ARCHIVED' })
        .expect(403);
    });
  });
});
