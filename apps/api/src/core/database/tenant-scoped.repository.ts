import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { RequestScope } from '@bops/contracts';

/**
 * Base class for every building-scoped repository.
 *
 * SECOND LINE OF DEFENCE. BuildingScopeGuard proves the caller may touch a
 * building; this makes it structurally awkward to then query a DIFFERENT one.
 * Defence in depth matters here because the first layer is a guard a future
 * route could forget to apply, while this one is inherited by the data-access
 * code itself.
 *
 * Usage:
 *   class UnitRepository extends TenantScopedRepository {
 *     findAll(scope: RequestScope) {
 *       return this.prisma.unit.findMany({ where: this.tenantWhere(scope) });
 *     }
 *   }
 */
export abstract class TenantScopedRepository {
  /**
   * Builds the mandatory tenant predicate. Spread it into EVERY where clause on
   * a building-scoped model:
   *   where: { ...this.tenantWhere(scope), status: 'ACTIVE' }
   */
  protected tenantWhere(scope: RequestScope): { buildingId: string } {
    if (!scope.buildingId) {
      // An org-scoped caller reaching a building-scoped repository is a routing
      // bug. Throwing beats returning an unfiltered query that would span every
      // building in the organization.
      throw new ForbiddenException(
        'Building scope required for this operation',
      );
    }
    return { buildingId: scope.buildingId };
  }

  /**
   * Verifies a row fetched by id actually belongs to the caller's building, for
   * the cases where a lookup by primary key is unavoidable.
   *
   * Throws NotFound rather than Forbidden on mismatch: telling a caller "that
   * exists but is not yours" leaks the existence of another tenant's data.
   */
  protected assertBelongsToScope<T extends { buildingId: string }>(
    entity: T | null,
    scope: RequestScope,
    resourceName: string,
  ): T {
    if (!entity || entity.buildingId !== scope.buildingId) {
      throw new NotFoundException(`${resourceName} not found`);
    }
    return entity;
  }

  /**
   * Standard "as of now" predicate for temporal tables (ownership, occupancy,
   * terms). Half-open interval, matching the DB exclusion constraints so app
   * and database agree on what "current" means.
   */
  protected currentPeriodWhere(asOf: Date = new Date()) {
    return {
      periodStart: { lte: asOf },
      OR: [{ periodEnd: null }, { periodEnd: { gt: asOf } }],
    };
  }

  /** Excludes soft-deleted rows. Every list query should include this (R2). */
  protected notArchivedWhere(): { archivedAt: null } {
    return { archivedAt: null };
  }
}
