/**
 * Test actors and fixture builders — everything here goes through the HTTP API.
 *
 * NOTHING IN THIS FILE WRITES TO THE DATABASE DIRECTLY, and that restraint is
 * the point. Seeding a membership row with Prisma would create a state the API
 * itself cannot produce, and a test that asserts isolation over hand-planted
 * rows proves nothing about the endpoints a client actually calls. Every actor
 * below is built the way a real user is built: register → create org → invite →
 * accept.
 */
import request from 'supertest';
import type { Server } from 'node:http';

import { unique } from './harness';

/** An authenticated test user plus the ids their fixtures produced. */
export interface Actor {
  readonly email: string;
  readonly password: string;
  readonly accessToken: string;
  readonly userId: string;
  readonly personId: string;
}

const PASSWORD = 'Aparteman1394';

/** Bearer header for an actor — every authenticated call goes through this. */
export function auth(actor: Actor): [string, string] {
  return ['Authorization', `Bearer ${actor.accessToken}`];
}

/**
 * Registers a fresh account and returns a usable actor.
 *
 * The account has NO tenancy: BM-01 §33 requires that a new user can reach
 * /auth/me and nothing else, which several tests below rely on as their
 * "outsider" baseline.
 */
export async function registerActor(
  server: Server,
  label = 'user',
): Promise<Actor> {
  const email = `${unique(label)}@example.com`;

  const registration = await request(server)
    .post('/api/auth/register')
    .send({
      email,
      password: PASSWORD,
      firstName: 'کاربر',
      lastName: 'آزمایشی',
    })
    .expect(201);

  const accessToken = registration.body.accessToken as string;

  const me = await request(server)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(200);

  return {
    email,
    password: PASSWORD,
    accessToken,
    userId: me.body.userId as string,
    personId: me.body.personId as string,
  };
}

/** Creates an organization; the actor becomes its ORG_OWNER. */
export async function createOrganization(
  server: Server,
  actor: Actor,
  name = 'شرکت مدیریت ساختمان',
): Promise<string> {
  const response = await request(server)
    .post('/api/organizations')
    .set(...auth(actor))
    .send({ name, slug: unique('org-') })
    .expect(201);

  return response.body.id as string;
}

export interface BuildingFixture {
  readonly id: string;
  readonly organizationId: string;
}

/**
 * Creates a building under an organization.
 *
 * `city` and `line1` vary per call by default so the §35 duplicate detector
 * does not fire and turn an unrelated test into a surprise 409.
 */
export async function createBuilding(
  server: Server,
  actor: Actor,
  organizationId: string,
  overrides: Record<string, unknown> = {},
): Promise<BuildingFixture> {
  const response = await request(server)
    .post(`/api/organizations/${organizationId}/buildings`)
    .set(...auth(actor))
    .send({
      name: `برج ${unique('')}`,
      address: {
        city: 'تهران',
        line1: `خیابان ${unique('خ')}، پلاک ${Math.floor(Math.random() * 900) + 10}`,
      },
      ...overrides,
    })
    .expect(201);

  return {
    id: response.body.id as string,
    organizationId: response.body.organizationId as string,
  };
}

/** Creates one unit in a building and returns its id. */
export async function createUnit(
  server: Server,
  actor: Actor,
  buildingId: string,
  label = unique('U'),
): Promise<string> {
  const response = await request(server)
    .post(`/api/buildings/${buildingId}/units`)
    .set(...auth(actor))
    .send({ label })
    .expect(201);

  return response.body.id as string;
}

/**
 * Runs the full invitation round trip: inviter creates it, invitee accepts it.
 *
 * This is the ONLY supported way to gain a building membership, so tests that
 * need a resident must go through it. Returns the accept response so callers
 * can assert on the granted scope.
 */
export async function inviteAndAccept(
  server: Server,
  inviter: Actor,
  invitee: Actor,
  options: {
    buildingId: string;
    role: string;
    unitId?: string;
  },
): Promise<Record<string, unknown>> {
  const created = await request(server)
    .post(`/api/buildings/${options.buildingId}/invitations`)
    .set(...auth(inviter))
    .send({
      role: options.role,
      email: invitee.email,
      ...(options.unitId ? { unitId: options.unitId } : {}),
    })
    .expect(201);

  const token = created.body.token as string;

  const accepted = await request(server)
    .post('/api/invitations/accept')
    .set(...auth(invitee))
    .send({ token })
    .expect(200);

  return accepted.body as Record<string, unknown>;
}

/** Organization-tier equivalent of inviteAndAccept. */
export async function inviteAndAcceptOrg(
  server: Server,
  inviter: Actor,
  invitee: Actor,
  organizationId: string,
  role: string,
): Promise<Record<string, unknown>> {
  const created = await request(server)
    .post(`/api/organizations/${organizationId}/invitations`)
    .set(...auth(inviter))
    .send({ role, email: invitee.email })
    .expect(201);

  const accepted = await request(server)
    .post('/api/invitations/accept')
    .set(...auth(invitee))
    .send({ token: created.body.token as string })
    .expect(200);

  return accepted.body as Record<string, unknown>;
}
