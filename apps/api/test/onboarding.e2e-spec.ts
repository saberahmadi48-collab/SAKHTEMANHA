/**
 * Onboarding, invitations and history — BM-01 §32, §33, §34 and §46 item 5.
 *
 * WHAT THIS SUITE IS FOR: the isolation suite proves the platform refuses the
 * wrong people. This one proves it ACCEPTS the right ones through the only door
 * that exists, and that closing a membership preserves the record instead of
 * erasing it (BM-00 rule 2 / R2).
 *
 * The through-line of every test here is that AUTHORITY IS NEVER
 * CLIENT-SUPPLIED. An invitee sends a token and nothing else; the scope, the
 * role and the unit all come from the row the inviter created. Several tests
 * below attack exactly that boundary.
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
  registerActor,
  type Actor,
  type BuildingFixture,
} from './actors';

describe('onboarding, invitations and history (BM-01 §32–§34, §46.5)', () => {
  let context: TestContext;
  let owner: Actor;
  let organizationId: string;
  let building: BuildingFixture;
  let unitId: string;

  beforeAll(async () => {
    context = await createTestApp();
    await resetDatabase(context.prisma);

    owner = await registerActor(context.server, 'orgowner');
    organizationId = await createOrganization(context.server, owner);
    building = await createBuilding(context.server, owner, organizationId);
    unitId = await createUnit(context.server, owner, building.id, '101');
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  // -------------------------------------------------------------------------
  //  §32: the onboarding chain
  // -------------------------------------------------------------------------

  describe('§32 onboarding chain', () => {
    it('makes the organization creator its ORG_OWNER in the same breath', async () => {
      // If these two writes were not one transaction, an organization could
      // exist that nobody — not even its creator — can administer, and it
      // would be unrecoverable without direct database surgery.
      const membership = await context.prisma.organizationMembership.findFirst({
        where: { organizationId, personId: owner.personId },
        select: { role: true, status: true },
      });

      expect(membership).not.toBeNull();
      expect(membership?.role).toBe('ORG_OWNER');
      expect(membership?.status).toBe('ACTIVE');
    });

    it('generates a building code when the client does not supply one (§37)', async () => {
      const row = await context.prisma.building.findUnique({
        where: { id: building.id },
        select: { code: true },
      });

      expect(row?.code).toBeTruthy();
    });

    it('bulk-generates units from a floor plan (§36)', async () => {
      const target = await createBuilding(
        context.server,
        owner,
        organizationId,
      );

      const response = await request(context.server)
        .post(`/api/buildings/${target.id}/units/generate`)
        .set(...auth(owner))
        .send({ floors: [{ floor: 1, unitsOnFloor: 2 }, { floor: 2, unitsOnFloor: 2 }] })
        .expect(201);

      const labels = (response.body.created as Array<{ label: string }>).map(
        (unit) => unit.label,
      );

      expect(labels).toEqual(['101', '102', '201', '202']);
    });

    it('skips existing labels on a re-run instead of overwriting them', async () => {
      // Overwriting would rewrite a unit that may already carry ownership and
      // ledger history (§14) — the whole reason `skipped` exists.
      const response = await request(context.server)
        .post(`/api/buildings/${building.id}/units/generate`)
        .set(...auth(owner))
        .send({ floors: [{ floor: 1, unitsOnFloor: 2 }] })
        .expect(201);

      expect(response.body.skipped).toContain('101');
    });
  });

  // -------------------------------------------------------------------------
  //  §33: invitation is the ONLY way in
  // -------------------------------------------------------------------------

  describe('§33 invitation round trip', () => {
    it('grants exactly the role the inviter chose, not the one the invitee wants', async () => {
      const invitee = await registerActor(context.server, 'tenant');

      const created = await request(context.server)
        .post(`/api/buildings/${building.id}/invitations`)
        .set(...auth(owner))
        .send({ role: 'TENANT', email: invitee.email, unitId })
        .expect(201);

      const token = created.body.token as string;
      expect(token).toBeTruthy();

      // The invitee sends ONLY the token. There is no field in which to state a
      // role, which is what makes privilege escalation structurally impossible
      // rather than merely checked.
      const accepted = await request(context.server)
        .post('/api/invitations/accept')
        .set(...auth(invitee))
        .send({ token })
        .expect(200);

      expect(accepted.body.buildingRole).toBe('TENANT');
      expect(accepted.body.buildingId).toBe(building.id);
      expect(accepted.body.unitId).toBe(unitId);

      // And the grant is real: the invitee can now read the building.
      await request(context.server)
        .get(`/api/buildings/${building.id}`)
        .set(...auth(invitee))
        .expect(200);
    });

    it('rejects an attempt to smuggle a role into the accept body', async () => {
      const invitee = await registerActor(context.server, 'escalate');

      const created = await request(context.server)
        .post(`/api/buildings/${building.id}/invitations`)
        .set(...auth(owner))
        .send({ role: 'TENANT', email: invitee.email })
        .expect(201);

      await request(context.server)
        .post('/api/invitations/accept')
        .set(...auth(invitee))
        .send({ token: created.body.token, role: 'BUILDING_MANAGER' })
        .expect(400);
    });

    it('never echoes the raw token in the invitation list', async () => {
      // Read access to the invitation list must not become the ability to
      // accept every pending invitation in the tenant.
      const response = await request(context.server)
        .get(`/api/buildings/${building.id}/invitations`)
        .set(...auth(owner))
        .expect(200);

      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('token');
      expect(serialized).not.toMatch(/tokenHash/);
    });

    it('masks contact details in the invitation list (BM-00 rule 6)', async () => {
      const response = await request(context.server)
        .get(`/api/buildings/${building.id}/invitations`)
        .set(...auth(owner))
        .expect(200);

      const rows = response.body as Array<{ email: string | null }>;
      const withEmail = rows.filter((row) => row.email);

      expect(withEmail.length).toBeGreaterThan(0);
      for (const row of withEmail) {
        // A masked address contains a star and is not the raw value.
        expect(row.email).toContain('*');
      }
    });

    it('refuses a token that has already been accepted', async () => {
      const invitee = await registerActor(context.server, 'replay');

      const created = await request(context.server)
        .post(`/api/buildings/${building.id}/invitations`)
        .set(...auth(owner))
        .send({ role: 'TENANT', email: invitee.email })
        .expect(201);

      const token = created.body.token as string;

      await request(context.server)
        .post('/api/invitations/accept')
        .set(...auth(invitee))
        .send({ token })
        .expect(200);

      // Second use must fail — otherwise a leaked link is a permanent key.
      const replay = await request(context.server)
        .post('/api/invitations/accept')
        .set(...auth(invitee))
        .send({ token })
        .expect(409);

      expect(String(replay.body.message)).toMatch(/[\u0600-\u06FF]/);
    });

    it('refuses a revoked invitation (§34)', async () => {
      const invitee = await registerActor(context.server, 'revoked');

      const created = await request(context.server)
        .post(`/api/buildings/${building.id}/invitations`)
        .set(...auth(owner))
        .send({ role: 'TENANT', email: invitee.email })
        .expect(201);

      await request(context.server)
        .post(
          `/api/buildings/${building.id}/invitations/${created.body.invitation.id}/revoke`,
        )
        .set(...auth(owner))
        .expect(200);

      // 404, NOT 409, and the difference is deliberate. An accepted invitation
      // may safely say "already used" — the holder is the person who used it.
      // A REVOKED one must be indistinguishable from a token that never
      // existed, because the holder of a revoked link is exactly who you do not
      // want to confirm "this was real, you are just too late" to.
      await request(context.server)
        .post('/api/invitations/accept')
        .set(...auth(invitee))
        .send({ token: created.body.token })
        .expect(404);

      // R2: revoking retains the row rather than deleting it.
      const row = await context.prisma.invitation.findUnique({
        where: { id: created.body.invitation.id as string },
        select: { status: true, revokedAt: true },
      });
      expect(row?.status).toBe('REVOKED');
      expect(row?.revokedAt).not.toBeNull();
    });

    it('refuses a forged token', async () => {
      const invitee = await registerActor(context.server, 'forger');

      await request(context.server)
        .post('/api/invitations/accept')
        .set(...auth(invitee))
        .send({ token: 'a'.repeat(64) })
        .expect(404);
    });

    it('previews without an account but reveals names only, never ids', async () => {
      const created = await request(context.server)
        .post(`/api/buildings/${building.id}/invitations`)
        .set(...auth(owner))
        .send({ role: 'TENANT', email: 'preview-target@example.com' })
        .expect(201);

      // No Authorization header: the recipient of the link may not have an
      // account yet — §32 onboarding often STARTS from this screen.
      const preview = await request(context.server)
        .get('/api/invitations/preview')
        .query({ token: created.body.token })
        .expect(200);

      expect(preview.body.buildingName).toBeTruthy();
      expect(preview.body.buildingRole).toBe('TENANT');

      // A leaked link must not yield an id that could feed another endpoint.
      const serialized = JSON.stringify(preview.body);
      expect(serialized).not.toContain(building.id);
      expect(serialized).not.toContain(organizationId);
    });
  });

  // -------------------------------------------------------------------------
  //  §46.5 / R2: ending a membership preserves the record
  // -------------------------------------------------------------------------

  describe('§46.5 history survives removal', () => {
    it('ends a membership without deleting the row', async () => {
      const resident = await registerActor(context.server, 'departing');

      const created = await request(context.server)
        .post(`/api/buildings/${building.id}/invitations`)
        .set(...auth(owner))
        .send({ role: 'TENANT', email: resident.email, unitId })
        .expect(201);

      await request(context.server)
        .post('/api/invitations/accept')
        .set(...auth(resident))
        .send({ token: created.body.token })
        .expect(200);

      const membership = await context.prisma.buildingMembership.findFirst({
        where: { buildingId: building.id, personId: resident.personId },
        select: { id: true },
      });
      expect(membership).not.toBeNull();

      await request(context.server)
        .post(`/api/buildings/${building.id}/members/${membership!.id}/end`)
        .set(...auth(owner))
        .send({ reason: 'نقل مکان' })
        .expect(200);

      // THE ROW MUST STILL EXIST. "Remove member" is a state transition, never
      // a delete — the ledger and audit trail reference this person.
      const after = await context.prisma.buildingMembership.findUnique({
        where: { id: membership!.id },
        select: { status: true, endedAt: true },
      });

      expect(after).not.toBeNull();
      expect(after?.status).toBe('ENDED');
      expect(after?.endedAt).not.toBeNull();
    });

    it('revokes access the moment the membership ends', async () => {
      const resident = await registerActor(context.server, 'evicted');

      const created = await request(context.server)
        .post(`/api/buildings/${building.id}/invitations`)
        .set(...auth(owner))
        .send({ role: 'TENANT', email: resident.email })
        .expect(201);

      await request(context.server)
        .post('/api/invitations/accept')
        .set(...auth(resident))
        .send({ token: created.body.token })
        .expect(200);

      await request(context.server)
        .get(`/api/buildings/${building.id}`)
        .set(...auth(resident))
        .expect(200);

      const membership = await context.prisma.buildingMembership.findFirst({
        where: { buildingId: building.id, personId: resident.personId },
        select: { id: true },
      });

      await request(context.server)
        .post(`/api/buildings/${building.id}/members/${membership!.id}/end`)
        .set(...auth(owner))
        .send({})
        .expect(200);

      // The access token is UNCHANGED and still cryptographically valid. It
      // stops working because ScopeService re-derives authority from live
      // membership rows on every request — that is why the token carries no
      // roles. A cached-claims design would still let this request through.
      await request(context.server)
        .get(`/api/buildings/${building.id}`)
        .set(...auth(resident))
        .expect(403);
    });

    it('closes unit memberships in the same transaction as the building one', async () => {
      const resident = await registerActor(context.server, 'unitresident');

      const created = await request(context.server)
        .post(`/api/buildings/${building.id}/invitations`)
        .set(...auth(owner))
        .send({ role: 'TENANT', email: resident.email, unitId })
        .expect(201);

      await request(context.server)
        .post('/api/invitations/accept')
        .set(...auth(resident))
        .send({ token: created.body.token })
        .expect(200);

      const membership = await context.prisma.buildingMembership.findFirst({
        where: { buildingId: building.id, personId: resident.personId },
        select: { id: true },
      });

      await request(context.server)
        .post(`/api/buildings/${building.id}/members/${membership!.id}/end`)
        .set(...auth(owner))
        .send({})
        .expect(200);

      // If the unit membership were left ACTIVE, scope.unitIds would still be
      // populated and the departed resident would keep unit-level access.
      const stillActive = await context.prisma.unitMembership.count({
        where: {
          buildingId: building.id,
          personId: resident.personId,
          status: 'ACTIVE',
        },
      });

      expect(stillActive).toBe(0);
    });

    it('refuses to remove the last organization owner', async () => {
      const membership = await context.prisma.organizationMembership.findFirst({
        where: { organizationId, personId: owner.personId },
        select: { id: true },
      });

      const response = await request(context.server)
        .post(
          `/api/organizations/${organizationId}/members/${membership!.id}/end`,
        )
        .set(...auth(owner))
        .send({});

      // Removing the last owner would create an organization nobody can
      // administer, with no recovery short of database surgery.
      expect(response.status).toBe(409);

      const after = await context.prisma.organizationMembership.findUnique({
        where: { id: membership!.id },
        select: { status: true },
      });
      expect(after?.status).toBe('ACTIVE');
    });

    it('archives a unit instead of deleting it (§16)', async () => {
      const target = await createUnit(
        context.server,
        owner,
        building.id,
        'ARCH-1',
      );

      await request(context.server)
        .post(`/api/buildings/${building.id}/units/${target}/archive`)
        .set(...auth(owner))
        .expect(200);

      const row = await context.prisma.unit.findUnique({
        where: { id: target },
        select: { archivedAt: true },
      });

      expect(row).not.toBeNull();
      expect(row?.archivedAt).not.toBeNull();
    });

    it('writes an audit trail for tenant mutations (§38)', async () => {
      const entries = await context.prisma.auditLog.count({
        where: { organizationId },
      });

      // Every mutation above should have left a trace. A zero here means the
      // audit service is wired but never actually called.
      expect(entries).toBeGreaterThan(0);
    });
  });
});
