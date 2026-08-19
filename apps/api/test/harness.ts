/**
 * Shared e2e harness: boots the REAL application against the REAL database.
 *
 * WHY THIS EXISTS AND WHY IT BOOTS THE WHOLE APP: BM-01 §46 items 4–5 ask for
 * proof that cross-building access is refused and that history survives. That
 * claim is only worth anything if the thing under test is the thing that ships.
 * Every guard, pipe and filter registered in main.ts is registered here in the
 * same order, so a test failure means the product is broken — not the harness.
 *
 * Deliberately NOT mocked: PrismaService (a mock cannot prove tenant isolation),
 * JwtAuthGuard and BuildingScopeGuard (they ARE the subject), and the validation
 * pipe (`forbidNonWhitelisted` is a tenancy control, not hygiene).
 *
 * The ONE thing overridden is the rate limiter — see createTestApp.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import type { Server } from 'node:http';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { PersianExceptionFilter } from '../src/core/http/persian-exception.filter';
import { createPersianValidationPipe } from '../src/core/http/validation-messages';

/**
 * Tables truncated between suites, ordered child-first.
 *
 * TRUNCATE … CASCADE is used rather than Prisma deletes for a reason that is
 * easy to trip over: PrismaService.safe BLOCKS hard deletes on every historical
 * model (BM-00 rule 2), so `prisma.building.deleteMany()` throws by design.
 * Raw SQL is the only honest way to reset state without weakening that rule.
 */
const TRUNCATED_TABLES = [
  'audit_logs',
  // BM-03 finance, child-first. These MUST be listed: a finance table left out
  // keeps rows across suites, and the ledger totals a later suite asserts on
  // would silently include another suite's charges.
  // Before ledger_entries and invoices: a payment references both. Leaving it
  // out also strands `(provider, providerTransactionId)` rows, so the NEXT
  // suite's "record a payment" fails on a duplicate reference it never created.
  'payments',
  'ledger_entries',
  'invoice_lines',
  'invoices',
  'charge_calculation_snapshots',
  'charges',
  'charge_runs',
  'charge_rules',
  'unit_credits',
  'unit_financial_accounts',
  'building_financial_accounts',
  'financial_periods',
  'invoice_number_sequences',
  'invitations',
  'unit_occupancies',
  'unit_ownerships',
  'unit_memberships',
  'building_memberships',
  'organization_memberships',
  'management_terms',
  'units',
  'building_settings',
  'buildings',
  'addresses',
  'refresh_tokens',
  'people',
  'users',
  'organizations',
] as const;

export interface TestContext {
  readonly app: INestApplication;
  readonly server: Server;
  readonly prisma: PrismaService;
}

/**
 * Boots the application exactly as main.ts does.
 *
 * RATE LIMITING IS THE ONE THING NEUTRALISED, and it is done by replacing the
 * throttler's OPTIONS, not its guard. Two dead ends worth recording:
 *
 *   - `.overrideGuard(ThrottlerGuard)` does NOT work. It only rewires guards
 *     attached via @UseGuards; ThrottlerGuard is registered as an APP_GUARD
 *     provider, so the real one still runs and suites die with 429 after the
 *     5-registrations-per-minute limit.
 *   - `.overrideProvider(APP_GUARD)` would work but is unacceptable: it
 *     replaces ALL THREE global guards, including JwtAuthGuard and
 *     BuildingScopeGuard — the very things the isolation suite exists to test.
 *     That would turn every isolation test into a green lie.
 *
 * `skipIf` keeps the real guard, the real pipeline and the real decorators in
 * place and only tells the limiter to let the request pass. The limits stay
 * enforced in production; a test-only counter is not a security property.
 */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(getOptionsToken())
    .useValue({ throttlers: [{ ttl: 60_000, limit: 120 }], skipIf: () => true })
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });

  // Mirrors main.ts. If these drift, the tests stop testing production
  // behaviour — the Persian messages and the whitelist are both asserted on.
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createPersianValidationPipe() as ValidationPipe);
  app.useGlobalFilters(new PersianExceptionFilter());

  await app.init();

  return {
    app,
    server: app.getHttpServer() as Server,
    // PrismaService, NOT PrismaClient: the container registers the subclass,
    // and asking for the base class throws "provider does not exist".
    prisma: app.get(PrismaService),
  };
}

/**
 * Empties every domain table.
 *
 * RESTART IDENTITY is included so sequence-derived values (building codes) are
 * reproducible across runs, and CASCADE covers the FK graph without having to
 * keep the order above perfectly right forever.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const list = TRUNCATED_TABLES.map((table) => `"public"."${table}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}

export async function closeTestApp(context: TestContext): Promise<void> {
  await context.app.close();
}

/** Deterministic-but-unique identifiers, so parallel suites cannot collide. */
let sequence = 0;
export function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}${Date.now().toString(36)}${sequence}`;
}
