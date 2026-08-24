import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type FinancialCategoryKind } from '@prisma/client';
import type { RequestScope } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { TenantScopedRepository } from '../../core/database/tenant-scoped.repository';
import type {
  CreateFinancialCategoryDto,
  FinancialCategoryResponse,
  ListFinancialCategoriesQueryDto,
  UpdateFinancialCategoryDto,
} from './dto/expense.dto';

/**
 * The building's chart of accounts (BM-03 §42).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CATEGORIES ARE DATA, NOT CODE, AND THERE IS NO DELETE.
 *
 * §42 requires categories be configurable per building — a tower with a pool
 * and a four-flat walk-up do not share a cost structure, and hardcoding an enum
 * would force every building into one shape and require a deploy to add
 * "Generator Fuel".
 *
 * Two things are therefore immutable once set, and both protect the reports:
 *
 *  1. `kind` NEVER CHANGES. Flipping "Elevator" from EXPENSE to INCOME midway
 *     through a year silently rewrites what every prior period total meant, and
 *     nothing in the books would record that it happened. There is no `kind` on
 *     the update DTO at all — the restriction is structural, not a check.
 *
 *  2. RETIRE, DO NOT DELETE. Last year's expenses point at their category, so
 *     removing the row orphans the books. `isActive: false` hides it from new
 *     entry while every historical figure keeps resolving. `remove` exists only
 *     to give an unused, never-referenced category a clean exit; the moment any
 *     document references it, it refuses and says to deactivate instead.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class FinancialCategoriesService extends TenantScopedRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async list(
    scope: RequestScope,
    query: ListFinancialCategoriesQueryDto = {},
  ): Promise<FinancialCategoryResponse[]> {
    const categories = await this.prisma.financialCategory.findMany({
      where: {
        ...this.tenantWhere(scope),
        ...(query.kind ? { kind: query.kind } : {}),
        // Default to active-only: the picker a manager sees when entering a bill
        // should not offer retired categories. `activeOnly: false` is the
        // reporting path, where historical categories must still appear.
        ...(query.activeOnly === false ? {} : { isActive: true }),
      },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });

    return categories.map(toCategoryResponse);
  }

  async create(
    scope: RequestScope,
    dto: CreateFinancialCategoryDto,
  ): Promise<FinancialCategoryResponse> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const category = await tx.financialCategory.create({
          data: {
            buildingId: scope.buildingId!,
            kind: dto.kind,
            name: dto.name.trim(),
            description: dto.description?.trim() ?? null,
            sortOrder: dto.sortOrder ?? 0,
          },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'finance.category.created',
          resourceType: 'FinancialCategory',
          resourceId: category.id,
          after: { kind: category.kind, name: category.name },
        });

        return category;
      });

      return toCategoryResponse(created);
    } catch (error) {
      // Translate the unique violation rather than letting it surface as a raw
      // 500. Same lesson as the ledger's idempotency key: match on P2002, not on
      // message text, which changes between driver versions.
      if (isDuplicateName(error)) {
        throw new ConflictException(ERRORS.categoryNameTaken);
      }
      throw error;
    }
  }

  /**
   * Renames, re-describes, reorders, or retires a category.
   *
   * Note what is missing: `kind`. See the class note — a category is bound to
   * one side of the books for life.
   */
  async update(
    scope: RequestScope,
    categoryId: string,
    dto: UpdateFinancialCategoryDto,
  ): Promise<FinancialCategoryResponse> {
    const existing = await this.load(scope, categoryId);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const category = await tx.financialCategory.update({
          where: { id: existing.id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.description !== undefined
              ? { description: dto.description?.trim() ?? null }
              : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'finance.category.updated',
          resourceType: 'FinancialCategory',
          resourceId: category.id,
          before: { name: existing.name, isActive: existing.isActive },
          after: { name: category.name, isActive: category.isActive },
        });

        return category;
      });

      return toCategoryResponse(updated);
    } catch (error) {
      if (isDuplicateName(error)) {
        throw new ConflictException(ERRORS.categoryNameTaken);
      }
      throw error;
    }
  }

  /**
   * Deletes a category that has never been used.
   *
   * Refuses the moment any expense or income references it — that is not a
   * technical limitation but the point: deleting a referenced category would
   * leave last year's totals pointing at nothing. The error tells the caller to
   * deactivate instead, which achieves what they actually wanted.
   */
  async remove(scope: RequestScope, categoryId: string): Promise<void> {
    const existing = await this.load(scope, categoryId);

    const [expenseCount, incomeCount] = await Promise.all([
      this.prisma.expense.count({ where: { categoryId: existing.id } }),
      this.prisma.income.count({ where: { categoryId: existing.id } }),
    ]);

    if (expenseCount > 0 || incomeCount > 0) {
      throw new ConflictException(ERRORS.categoryHasRecords);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.financialCategory.delete({ where: { id: existing.id } });

      await this.audit.logInTransaction(tx, scope, {
        action: 'finance.category.deleted',
        resourceType: 'FinancialCategory',
        resourceId: existing.id,
        before: { kind: existing.kind, name: existing.name },
      });
    });
  }

  /**
   * Resolves a category for a NEW expense or income, enforcing both invariants
   * the writing services depend on.
   *
   * Shared rather than duplicated in each caller because "we forgot to check the
   * kind on the income path" is exactly how a building ends up with a rental
   * receipt filed under an expense category, making both sides of the report
   * wrong at once.
   */
  async resolveForEntry(
    scope: RequestScope,
    categoryId: string,
    expectedKind: FinancialCategoryKind,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; name: string; kind: FinancialCategoryKind }> {
    const client = tx ?? this.prisma;

    const category = await client.financialCategory.findFirst({
      where: { id: categoryId, buildingId: scope.buildingId! },
      select: { id: true, name: true, kind: true, isActive: true },
    });

    if (!category) throw new NotFoundException(ERRORS.categoryNotFound);
    if (category.kind !== expectedKind) {
      throw new ConflictException(ERRORS.categoryKindMismatch);
    }
    // Retired categories stay readable for history but must not accept new
    // documents — otherwise "retired" means nothing.
    if (!category.isActive) {
      throw new ConflictException(ERRORS.categoryInactive);
    }

    return { id: category.id, name: category.name, kind: category.kind };
  }

  private async load(scope: RequestScope, categoryId: string) {
    const category = await this.prisma.financialCategory.findFirst({
      where: { id: categoryId, ...this.tenantWhere(scope) },
    });
    if (!category) throw new NotFoundException(ERRORS.categoryNotFound);
    return category;
  }
}

function toCategoryResponse(category: {
  id: string;
  kind: string;
  name: string;
  systemKey: string | null;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
}): FinancialCategoryResponse {
  return {
    id: category.id,
    kind: category.kind,
    name: category.name,
    systemKey: category.systemKey,
    description: category.description,
    isActive: category.isActive,
    sortOrder: category.sortOrder,
    createdAt: category.createdAt.toISOString(),
  };
}

/** True when a write collided with the (buildingId, kind, name) unique. */
function isDuplicateName(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
