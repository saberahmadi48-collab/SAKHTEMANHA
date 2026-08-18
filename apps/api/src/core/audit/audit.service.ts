import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestScope } from '@bops/contracts';

import { PrismaService } from '../database/prisma.service';

/**
 * Writes the append-only audit trail required by BM-01 §38 and BM-00 rule 2.
 *
 * Every privileged state change — building created, unit archived, ownership
 * transferred, role assigned — records one row here. The table is never updated
 * or deleted (PrismaService blocks hard deletes on AuditLog), so the trail is
 * the forensic record of who did what to which tenant's data.
 *
 * THREE DESIGN CHOICES WORTH KNOWING:
 *
 *  1. Audit writes NEVER fail the business operation. A logging failure that
 *     rolls back a legitimate building update would be a self-inflicted outage,
 *     so a failed insert is logged loudly to the operator channel and swallowed.
 *     The exception is `logInTransaction`, which is used when the caller
 *     deliberately wants the audit row to share the operation's atomicity.
 *
 *  2. Snapshots are REDACTED before they are stored. `before`/`after` are raw
 *     entity objects and would otherwise persist password hashes and invitation
 *     token hashes into a table that every AUDIT_READ holder can read.
 *
 *  3. Prisma `Decimal` and `Date` are converted to strings. jsonb cannot hold
 *     them, and `Object.entries` on a Decimal yields its internal digit array —
 *     an unreadable audit row rather than "100.000".
 */

/** Field names whose values must never reach the audit table. */
const REDACTED_FIELDS = new Set<string>([
  'passwordHash',
  'password',
  'passwordConfirm',
  'tokenHash',
  'token',
  'mfaSecret',
  'refreshToken',
  'accessToken',
]);

const REDACTED_PLACEHOLDER = '[redacted]';

/** One auditable event. `action` is a dotted verb: "unit.ownership.transferred". */
export interface AuditEvent {
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  /** Request metadata, when the caller has an HTTP request in hand. */
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string | null;
}

/**
 * Identity of the actor for events raised OUTSIDE a resolved tenant scope —
 * registration and login, which happen before any building exists for the user.
 */
export interface AuditActor {
  readonly organizationId?: string | null;
  readonly buildingId?: string | null;
  readonly userId?: string | null;
  readonly personId?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records an event attributed to the caller's proven scope.
   *
   * Takes the RequestScope rather than loose ids on purpose: the actor and the
   * tenant are then guaranteed to be the ones the guard verified, not values a
   * service assembled from a request body.
   */
  async log(scope: RequestScope, event: AuditEvent): Promise<void> {
    await this.logAs(
      {
        organizationId: scope.organizationId,
        buildingId: scope.buildingId,
        userId: scope.userId,
        personId: scope.personId,
      },
      event,
    );
  }

  /**
   * Records an event for an actor with no tenant scope yet (registration,
   * login, token refresh). Same swallow-on-failure contract as `log`.
   */
  async logAs(actor: AuditActor, event: AuditEvent): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: this.toRow(actor, event) });
    } catch (error) {
      // Deliberately swallowed — see the class docblock. Logged at error level
      // because a persistently failing audit trail is a compliance incident
      // even though it is not a request failure.
      this.logger.error(
        `Failed to write audit row for ${event.action} on ${event.resourceType}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Records an event inside an existing transaction, so the audit row and the
   * change commit or roll back together.
   *
   * Use this for operations where an unrecorded change is worse than a failed
   * one — ownership transfers, role grants, term termination. Unlike `log`,
   * this DOES propagate failures, which is the entire point.
   */
  async logInTransaction(
    tx: Prisma.TransactionClient,
    actor: RequestScope | AuditActor,
    event: AuditEvent,
  ): Promise<void> {
    await tx.auditLog.create({ data: this.toRow(actor, event) });
  }

  /** Maps an actor + event onto the AuditLog row shape. */
  private toRow(
    actor: RequestScope | AuditActor,
    event: AuditEvent,
  ): Prisma.AuditLogUncheckedCreateInput {
    return {
      organizationId: actor.organizationId ?? null,
      buildingId: actor.buildingId ?? null,
      actorUserId: actor.userId ?? null,
      actorPersonId: actor.personId ?? null,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId ?? null,
      before: redact(event.before),
      after: redact(event.after),
      ipAddress: event.ipAddress ?? null,
      userAgent: event.userAgent ?? null,
      requestId: event.requestId ?? null,
    };
  }
}

/**
 * Prepares a snapshot for jsonb storage: sensitive fields replaced, Dates and
 * Decimals stringified.
 *
 * Returns Prisma's `JsonNull` (not JS `null`) for an absent snapshot so the
 * column stores SQL NULL rather than the JSON literal `null` — in Postgres
 * jsonb those are different values and only the former means "no snapshot".
 */
function redact(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return sanitize(value) as Prisma.InputJsonValue;
}

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;

  // Prisma Decimal (decimal.js) — detected structurally rather than by importing
  // the runtime type, which keeps this file free of a decimal.js dependency.
  if (typeof (value as { toFixed?: unknown }).toFixed === 'function') {
    return String(value);
  }

  if (Array.isArray(value)) return value.map(sanitize);

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = REDACTED_FIELDS.has(key)
      ? REDACTED_PLACEHOLDER
      : sanitize(item);
  }
  return result;
}
