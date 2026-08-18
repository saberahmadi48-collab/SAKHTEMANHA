import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Prisma client bound to the Nest lifecycle.
 *
 * Two platform-wide invariants are enforced here as a client extension rather
 * than left to reviewer discipline:
 *
 *  1. NO HARD DELETES on historical tables (BM-00 rule 2). `delete`/`deleteMany`
 *     against a protected model throws. Callers must archive (set `archivedAt`)
 *     or close a period instead. Enforcing it at the client means a new module
 *     written six months from now inherits the rule for free.
 *
 *  2. Slow-query visibility — a multi-tenant query that forgot its buildingId
 *     filter usually shows up first as a table scan, so the log is an early
 *     warning for isolation bugs, not just a performance tool.
 */

/** Models whose rows constitute history and must never be hard-deleted. */
const DELETE_PROTECTED_MODELS = new Set<string>([
  'Organization',
  'Building',
  'Unit',
  'Person',
  'User',
  'ManagementTerm',
  'OrganizationMembership',
  'BuildingMembership',
  'UnitMembership',
  'UnitOwnership',
  'UnitOccupancy',
  'AuditLog',
]);

const SLOW_QUERY_MS = 300;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();

    // Prisma's typed event map does not describe the dynamic 'query' channel in
    // a way that survives `strict`, hence the narrow cast at this single point.
    (
      this as unknown as {
        $on: (
          event: 'query',
          callback: (e: Prisma.QueryEvent) => void,
        ) => void;
      }
    ).$on('query', (event) => {
      if (event.duration >= SLOW_QUERY_MS) {
        this.logger.warn(
          `Slow query (${event.duration}ms): ${event.query.slice(0, 500)}`,
        );
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Returns a client that refuses hard deletes on historical models (R2).
   * Use this wherever domain services need write access.
   */
  get safe() {
    return this.$extends({
      query: {
        $allModels: {
          async delete({ model, args, query }) {
            assertDeletable(model);
            return query(args);
          },
          async deleteMany({ model, args, query }) {
            assertDeletable(model);
            return query(args);
          },
        },
      },
    });
  }
}

function assertDeletable(model: string): void {
  if (DELETE_PROTECTED_MODELS.has(model)) {
    throw new Error(
      `Hard delete blocked on ${model}: BM-00 rule 2 requires archive/reversal. ` +
        `Set archivedAt, close the period, or write a reversing entry instead.`,
    );
  }
}
