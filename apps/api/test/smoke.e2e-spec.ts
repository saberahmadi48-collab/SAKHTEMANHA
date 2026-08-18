/**
 * Smoke test: proves the harness can boot the real app against the real
 * database and complete one round trip. Kept separate from the behavioural
 * suites so that "the harness is broken" and "the product is broken" are
 * distinguishable at a glance in the reporter.
 */
import request from 'supertest';

import { closeTestApp, createTestApp, resetDatabase, type TestContext } from './harness';
import { registerActor } from './actors';

describe('e2e harness', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp();
    await resetDatabase(context.prisma);
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('boots the application and reaches the database', async () => {
    const rows = await context.prisma.$queryRawUnsafe<Array<{ ok: number }>>(
      'SELECT 1 as ok',
    );
    expect(rows[0]?.ok).toBe(1);
  });

  it('registers a real account through the HTTP layer', async () => {
    const actor = await registerActor(context.server, 'smoke');
    expect(actor.userId).toBeTruthy();
    expect(actor.personId).toBeTruthy();
  });

  it('rejects an unauthenticated request with Persian text', async () => {
    const response = await request(context.server)
      .get('/api/organizations')
      .expect(401);

    // The message must be Persian — an English internal string reaching a
    // browser would breach the all-Persian UI requirement.
    expect(String(response.body.message)).toMatch(/[\u0600-\u06FF]/);
  });
});
