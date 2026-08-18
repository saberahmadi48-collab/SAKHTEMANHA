/**
 * Identity, privacy & verification e2e — the proof for the BM-02 §54 security
 * gate and the §55 acceptance criteria that BM-01's suites did not cover.
 *
 * WHAT THIS SUITE IS ACTUALLY FOR: BM-02 is mostly a set of NEGATIVE claims —
 * private data is not leaked, a reviewer cannot bless their own claim, a user
 * cannot edit an identity that has been relied upon. Negative claims are the
 * ones that rot silently, because nothing visibly breaks when they stop being
 * true. So the assertions below are deliberately written as "this must NOT be
 * present / must NOT succeed" against a real HTTP surface.
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

describe('identity, privacy & verification (BM-02)', () => {
  let context: TestContext;
  let server: Server;

  /** ORG_OWNER — holds every permission including VERIFICATION_MANAGE. */
  let manager: Actor;
  /** Building-role OWNER — holds OWNERSHIP_READ, no manage, no contact. */
  let owner: Actor;
  /** Building-role TENANT — the least-privileged member. */
  let tenant: Actor;

  let buildingId: string;
  let unitId: string;
  let orgId: string;

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
    owner = await registerActor(server, 'owner');
    tenant = await registerActor(server, 'tenant');

    orgId = await createOrganization(server, manager);
    const organizationId = orgId;
    const building = await createBuilding(server, manager, organizationId);
    buildingId = building.id;
    unitId = await createUnit(server, manager, buildingId, 'واحد ۱۲');

    await inviteAndAccept(server, manager, owner, {
      buildingId,
      role: 'OWNER',
    });
    await inviteAndAccept(server, manager, tenant, {
      buildingId,
      role: 'TENANT',
    });
  });

  // -------------------------------------------------------------------------
  //  §41 — self-service profile
  // -------------------------------------------------------------------------

  describe('self-service profile (§41)', () => {
    it('returns the caller their OWN unmasked contact details', async () => {
      await request(server)
        .patch('/api/users/me/profile')
        .set(...auth(owner))
        .send({ phoneNumber: '09121234567', phoneIsPublic: false })
        .expect(200);

      const response = await request(server)
        .get('/api/users/me/profile')
        .set(...auth(owner))
        .expect(200);

      // Unmasked despite phoneIsPublic=false and no PERSON_READ_CONTACT: the
      // privacy rule protects a person from OTHERS, not from themselves.
      expect(response.body.phoneNumber).toBe('09121234567');
      expect(response.body.identityLocked).toBe(false);
    });

    it('never echoes the manager-only `notes` field back to the subject', async () => {
      const response = await request(server)
        .get('/api/users/me/profile')
        .set(...auth(owner))
        .expect(200);

      // `notes` is the manager's internal remarks about a resident. Returning
      // it here would turn a private annotation into a message to its subject.
      expect(response.body).not.toHaveProperty('notes');
    });

    it('normalizes Persian digits so a Persian keyboard is not rejected', async () => {
      const response = await request(server)
        .patch('/api/users/me/profile')
        .set(...auth(owner))
        // ۰۹۱۲۳۴۵۶۷۸۹ typed on a Persian keyboard.
        .send({ phoneNumber: '۰۹۱۲۳۴۵۶۷۸۹' })
        .expect(200);

      expect(response.body.phoneNumber).toBe('09123456789');
    });

    it('refuses a role, membership or building field in the profile body', async () => {
      // The DTO whitelists; anything else must be stripped or rejected rather
      // than silently applied. Either outcome is safe — what must NOT happen is
      // the caller gaining authority.
      await request(server)
        .patch('/api/users/me/profile')
        .set(...auth(tenant))
        .send({ firstName: 'سارا', role: 'BUILDING_MANAGER', buildingId })
        .expect((response) => {
          if (![200, 400].includes(response.status)) {
            throw new Error(`unexpected status ${response.status}`);
          }
        });

      // Whatever the status was, the tenant must still be a TENANT.
      const me = await request(server)
        .get('/api/auth/me')
        .set(...auth(tenant))
        .expect(200);

      const permissions: string[] = me.body.permissions ?? [];
      expect(permissions).not.toContain('member:update_role');
      expect(permissions).not.toContain('building:update');
    });

    it('rejects a national id that is not exactly ten digits', async () => {
      await request(server)
        .patch('/api/users/me/profile')
        .set(...auth(owner))
        .send({ nationalId: '123' })
        .expect(400);
    });

    it('refuses a national id already held by another person', async () => {
      await request(server)
        .patch('/api/users/me/profile')
        .set(...auth(owner))
        .send({ nationalId: '0012345678' })
        .expect(200);

      await request(server)
        .patch('/api/users/me/profile')
        .set(...auth(tenant))
        .send({ nationalId: '0012345678' })
        .expect(409);
    });
  });

  // -------------------------------------------------------------------------
  //  §24/§25/§26 — privacy classes and contact masking
  // -------------------------------------------------------------------------

  describe('contact privacy (§24/§25/§26)', () => {
    beforeEach(async () => {
      await request(server)
        .patch('/api/users/me/profile')
        .set(...auth(owner))
        .send({ phoneNumber: '09121234567', phoneIsPublic: false })
        .expect(200);
    });

    it('masks another member’s phone from a caller without PERSON_READ_CONTACT', async () => {
      // The building-role OWNER holds MEMBER_READ but NOT PERSON_READ_CONTACT.
      const response = await request(server)
        .get(`/api/buildings/${buildingId}/members`)
        .set(...auth(owner))
        .expect(200);

      const target = response.body.find(
        (row: { person: { personId: string } }) =>
          row.person.personId === tenant.personId,
      );
      expect(target).toBeDefined();
      expect(target.person.contactMasked).toBe(true);

      // The masked value must not contain the real number anywhere — a partial
      // mask that still ships the full string in another field is not a mask.
      expect(JSON.stringify(response.body)).not.toContain('09121234567');
    });

    it('reveals contact to a caller who DOES hold PERSON_READ_CONTACT', async () => {
      const response = await request(server)
        .get(`/api/buildings/${buildingId}/members`)
        .set(...auth(manager))
        .expect(200);

      const target = response.body.find(
        (row: { person: { personId: string } }) =>
          row.person.personId === owner.personId,
      );
      expect(target.person.contactMasked).toBe(false);
      expect(target.person.phoneNumber).toBe('09121234567');
    });

    it('honours the person’s own consent flag independently of the caller', async () => {
      // The TENANT's phone stays private; the OWNER opts in. Read by the same
      // caller in the same response, so the ONLY difference between the two
      // rows is the subject's own consent — which is exactly the claim.
      await request(server)
        .patch('/api/users/me/profile')
        .set(...auth(tenant))
        .send({ phoneNumber: '09350000000', phoneIsPublic: true })
        .expect(200);

      // Read as `owner`: holds MEMBER_READ but NOT PERSON_READ_CONTACT, so the
      // caller-permission gate is OFF for both rows.
      const response = await request(server)
        .get(`/api/buildings/${buildingId}/members`)
        .set(...auth(owner))
        .expect(200);

      const consented = response.body.find(
        (row: { person: { personId: string } }) =>
          row.person.personId === tenant.personId,
      );
      const withheld = response.body.find(
        (row: { person: { personId: string } }) =>
          row.person.personId === owner.personId,
      );

      // Consent alone flips it — same caller, same request, opposite outcome.
      expect(consented.person.contactMasked).toBe(false);
      expect(consented.person.phoneNumber).toBe('09350000000');
      expect(withheld.person.contactMasked).toBe(true);
    });

    it('never exposes a national id through the member directory (§45)', async () => {
      await request(server)
        .patch('/api/users/me/profile')
        .set(...auth(owner))
        .send({ nationalId: '0012345678' })
        .expect(200);

      // Checked from the MANAGER's view — the most privileged directory reader.
      // Even they get no identity reference from a list endpoint.
      const response = await request(server)
        .get(`/api/buildings/${buildingId}/members`)
        .set(...auth(manager))
        .expect(200);

      expect(JSON.stringify(response.body)).not.toContain('0012345678');
    });
  });

  // -------------------------------------------------------------------------
  //  §31/§32 — ownership & occupancy verification
  // -------------------------------------------------------------------------

  describe('verification (§31/§32)', () => {
    let ownershipId: string;

    beforeEach(async () => {
      const created = await request(server)
        .post(`/api/buildings/${buildingId}/ownerships`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: owner.personId,
          periodStart: new Date('2024-01-01T00:00:00Z').toISOString(),
        })
        .expect(201);

      ownershipId = created.body.id as string;
    });

    it('records a new title claim as UNVERIFIED rather than trusted', async () => {
      const response = await request(server)
        .get(`/api/buildings/${buildingId}/ownerships/${ownershipId}`)
        .set(...auth(manager))
        .expect(200);

      // The default matters: a claim that arrives already trusted makes the
      // whole verification state model decorative.
      expect(response.body.verification.status).toBe('UNVERIFIED');
      expect(response.body.verification.verifiedAt).toBeNull();
      expect(response.body.verification.verifiedByPersonId).toBeNull();
    });

    it('stamps the reviewer from the token, not from the request body', async () => {
      await request(server)
        .post(
          `/api/buildings/${buildingId}/ownerships/${ownershipId}/verification`,
        )
        .set(...auth(manager))
        // A hostile client naming someone else as the reviewer. The DTO
        // whitelists, so this extra property is REJECTED outright (400) rather
        // than silently ignored — an even stronger outcome than stripping it.
        .send({ status: 'VERIFIED', verifiedByPersonId: owner.personId })
        .expect(400);

      // The honest request stamps the caller, proving the reviewer comes from
      // the token and nowhere else.
      const response = await request(server)
        .post(
          `/api/buildings/${buildingId}/ownerships/${ownershipId}/verification`,
        )
        .set(...auth(manager))
        .send({ status: 'VERIFIED' })
        .expect(200);

      expect(response.body.verification.status).toBe('VERIFIED');
      // The manager reviewed it; the body's claim is ignored entirely.
      expect(response.body.verification.verifiedByPersonId).toBe(
        manager.personId,
      );
      expect(response.body.verification.verifiedAt).not.toBeNull();
    });

    it('refuses a rejection with no stated reason', async () => {
      await request(server)
        .post(
          `/api/buildings/${buildingId}/ownerships/${ownershipId}/verification`,
        )
        .set(...auth(manager))
        .send({ status: 'REJECTED' })
        .expect(400);
    });

    it('accepts a rejection WITH a reason and keeps the note', async () => {
      const response = await request(server)
        .post(
          `/api/buildings/${buildingId}/ownerships/${ownershipId}/verification`,
        )
        .set(...auth(manager))
        .send({ status: 'REJECTED', note: 'سند ارائه‌شده ناخوانا بود' })
        .expect(200);

      expect(response.body.verification.status).toBe('REJECTED');
      expect(response.body.verification.note).toBe('سند ارائه‌شده ناخوانا بود');
    });

    it('REJECTED does not delete the relationship (R2)', async () => {
      await request(server)
        .post(
          `/api/buildings/${buildingId}/ownerships/${ownershipId}/verification`,
        )
        .set(...auth(manager))
        .send({ status: 'REJECTED', note: 'مدرک ناکافی' })
        .expect(200);

      // Rejection is a judgement about PROOF, never a delete. The period must
      // still be there and still be current.
      const stillThere = await request(server)
        .get(`/api/buildings/${buildingId}/ownerships/${ownershipId}`)
        .set(...auth(manager))
        .expect(200);

      expect(stillThere.body.id).toBe(ownershipId);
      expect(stillThere.body.isCurrent).toBe(true);
    });

    it('clears the reviewer stamp when a decision is reopened to PENDING', async () => {
      await request(server)
        .post(
          `/api/buildings/${buildingId}/ownerships/${ownershipId}/verification`,
        )
        .set(...auth(manager))
        .send({ status: 'VERIFIED' })
        .expect(200);

      const reopened = await request(server)
        .post(
          `/api/buildings/${buildingId}/ownerships/${ownershipId}/verification`,
        )
        .set(...auth(manager))
        .send({ status: 'PENDING', note: 'نیاز به بازبینی مجدد' })
        .expect(200);

      // A stale verifiedAt on a row awaiting review would make an unreviewed
      // claim look approved to anything that checks the timestamp.
      expect(reopened.body.verification.status).toBe('PENDING');
      expect(reopened.body.verification.verifiedAt).toBeNull();
      expect(reopened.body.verification.verifiedByPersonId).toBeNull();
    });

    it('denies verification to a member without VERIFICATION_MANAGE', async () => {
      // The building-role OWNER can READ ownerships but must not attest to one.
      await request(server)
        .post(
          `/api/buildings/${buildingId}/ownerships/${ownershipId}/verification`,
        )
        .set(...auth(owner))
        .send({ status: 'VERIFIED' })
        .expect(403);
    });

    it('refuses to let a reviewer verify their OWN claim', async () => {
      // A resident who ALSO holds VERIFICATION_MANAGE — the realistic case: a
      // building manager who happens to own a flat in their own building.
      const ownerManager = await registerActor(server, 'ownermgr');
      await inviteAndAccept(server, manager, ownerManager, {
        buildingId,
        role: 'OWNER',
      });
      // Grant the reviewing permission at the organization tier, which is the
      // only way to hold it alongside a resident building role.
      await request(server)
        .post(`/api/organizations/${orgId}/invitations`)
        .set(...auth(manager))
        .send({ role: 'ORG_ADMIN', email: ownerManager.email })
        .expect(201)
        .then((created) =>
          request(server)
            .post('/api/invitations/accept')
            .set(...auth(ownerManager))
            .send({ token: created.body.token })
            .expect(200),
        );

      const secondUnit = await createUnit(
        server,
        manager,
        buildingId,
        'واحد ۱۴',
      );
      const own = await request(server)
        .post(`/api/buildings/${buildingId}/ownerships`)
        .set(...auth(manager))
        .send({
          unitId: secondUnit,
          personId: ownerManager.personId,
          periodStart: new Date('2024-01-01T00:00:00Z').toISOString(),
        })
        .expect(201);

      // Holding VERIFICATION_MANAGE says "trusted to check documents", not
      // "this person's own claims need no checking". This is precisely the case
      // where an independent reviewer matters most.
      await request(server)
        .post(
          `/api/buildings/${buildingId}/ownerships/${own.body.id}/verification`,
        )
        .set(...auth(ownerManager))
        .send({ status: 'VERIFIED' })
        .expect(403);

      // ...and the manager, who has no stake in it, still can.
      await request(server)
        .post(
          `/api/buildings/${buildingId}/ownerships/${own.body.id}/verification`,
        )
        .set(...auth(manager))
        .send({ status: 'VERIFIED' })
        .expect(200);
    });
  });

  // -------------------------------------------------------------------------
  //  §41 — identity freezes once it has been relied upon
  // -------------------------------------------------------------------------

  describe('identity lock after verification (§41)', () => {
    it('locks the national id once a relationship is VERIFIED', async () => {
      await request(server)
        .patch('/api/users/me/profile')
        .set(...auth(owner))
        .send({ nationalId: '0012345678' })
        .expect(200);

      const created = await request(server)
        .post(`/api/buildings/${buildingId}/ownerships`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: owner.personId,
          periodStart: new Date('2024-01-01T00:00:00Z').toISOString(),
        })
        .expect(201);

      await request(server)
        .post(
          `/api/buildings/${buildingId}/ownerships/${created.body.id}/verification`,
        )
        .set(...auth(manager))
        .send({ status: 'VERIFIED' })
        .expect(200);

      // The attestation was made about a SPECIFIC identity; silently swapping
      // it afterwards would make the manager's approval a statement about
      // someone else entirely.
      await request(server)
        .patch('/api/users/me/profile')
        .set(...auth(owner))
        .send({ nationalId: '0087654321' })
        .expect(409);

      const profile = await request(server)
        .get('/api/users/me/profile')
        .set(...auth(owner))
        .expect(200);

      expect(profile.body.identityLocked).toBe(true);
      expect(profile.body.nationalId).toBe('0012345678');
    });

    it('still allows consent and display changes while identity is locked', async () => {
      await request(server)
        .patch('/api/users/me/profile')
        .set(...auth(owner))
        .send({ nationalId: '0012345678' })
        .expect(200);

      const created = await request(server)
        .post(`/api/buildings/${buildingId}/ownerships`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: owner.personId,
          periodStart: new Date('2024-01-01T00:00:00Z').toISOString(),
        })
        .expect(201);

      await request(server)
        .post(
          `/api/buildings/${buildingId}/ownerships/${created.body.id}/verification`,
        )
        .set(...auth(manager))
        .send({ status: 'VERIFIED' })
        .expect(200);

      // Consent that only an administrator can withdraw is not consent, so
      // phoneIsPublic deliberately sits OUTSIDE the identity lock.
      const response = await request(server)
        .patch('/api/users/me/profile')
        .set(...auth(owner))
        .send({ phoneIsPublic: true, displayName: 'آقای مالک' })
        .expect(200);

      expect(response.body.phoneIsPublic).toBe(true);
      expect(response.body.displayName).toBe('آقای مالک');
    });

    it('does NOT lock identity while a claim is merely PENDING review', async () => {
      await request(server)
        .patch('/api/users/me/profile')
        .set(...auth(owner))
        .send({ nationalId: '0012345678' })
        .expect(200);

      const created = await request(server)
        .post(`/api/buildings/${buildingId}/ownerships`)
        .set(...auth(manager))
        .send({
          unitId,
          personId: owner.personId,
          periodStart: new Date('2024-01-01T00:00:00Z').toISOString(),
        })
        .expect(201);

      await request(server)
        .post(
          `/api/buildings/${buildingId}/ownerships/${created.body.id}/verification`,
        )
        .set(...auth(manager))
        .send({ status: 'PENDING' })
        .expect(200);

      // Nobody has relied on the number yet. Freezing it here would let a slow
      // reviewer lock a user out of correcting their own typo.
      await request(server)
        .patch('/api/users/me/profile')
        .set(...auth(owner))
        .send({ nationalId: '0087654321' })
        .expect(200);
    });
  });

  // -------------------------------------------------------------------------
  //  §44 — IDOR / BOLA across buildings
  // -------------------------------------------------------------------------

  describe('cross-building isolation (§44)', () => {
    it('cannot verify an ownership belonging to another building', async () => {
      // A second, entirely separate tenant.
      const outsider = await registerActor(server, 'outsider');
      const otherOrg = await createOrganization(
        server,
        outsider,
        'شرکت دیگر',
      );
      const otherBuilding = await createBuilding(
        server,
        outsider,
        otherOrg,
      );
      const otherUnit = await createUnit(
        server,
        outsider,
        otherBuilding.id,
        'واحد ۱',
      );
      // The title holder must be a member of THAT building first — creating an
      // org does not make you a resident of its buildings.
      const otherResident = await registerActor(server, 'otherres');
      await inviteAndAccept(server, outsider, otherResident, {
        buildingId: otherBuilding.id,
        role: 'OWNER',
      });

      const foreign = await request(server)
        .post(`/api/buildings/${otherBuilding.id}/ownerships`)
        .set(...auth(outsider))
        .send({
          unitId: otherUnit,
          personId: otherResident.personId,
          periodStart: new Date('2024-01-01T00:00:00Z').toISOString(),
        })
        .expect(201);

      // Our manager holds VERIFICATION_MANAGE — in THEIR building. Pointing it
      // at a foreign row must fail on the tenant boundary, and must 404 rather
      // than 403 so the row's existence is not confirmed.
      await request(server)
        .post(
          `/api/buildings/${buildingId}/ownerships/${foreign.body.id}/verification`,
        )
        .set(...auth(manager))
        .send({ status: 'VERIFIED' })
        .expect(404);

      // And the foreign row must be untouched — a guard that returns 404 AFTER
      // writing is still a breach.
      const untouched = await request(server)
        .get(`/api/buildings/${otherBuilding.id}/ownerships/${foreign.body.id}`)
        .set(...auth(outsider))
        .expect(200);

      expect(untouched.body.verification.status).toBe('UNVERIFIED');
    });

    it('cannot read another building’s member directory', async () => {
      const outsider = await registerActor(server, 'outsider2');
      const otherOrg = await createOrganization(server, outsider, 'شرکت سوم');
      const otherBuilding = await createBuilding(server, outsider, otherOrg);

      await request(server)
        .get(`/api/buildings/${otherBuilding.id}/members`)
        .set(...auth(manager))
        .expect(403);
    });
  });
});
