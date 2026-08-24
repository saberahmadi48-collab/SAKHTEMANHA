import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestScope } from '@bops/contracts';

import {
  CurrentScope,
  RequirePermissions,
  ScopedTo,
} from '../../core/authorization/authorization.decorators';
import { FinancialCategoriesService } from './financial-categories.service';
import {
  CreateFinancialCategoryDto,
  ListFinancialCategoriesQueryDto,
  UpdateFinancialCategoryDto,
  type FinancialCategoryResponse,
} from './dto/expense.dto';

/**
 * The building's chart of accounts — `/api/buildings/{id}/financial-categories`
 * (BM-03 §42).
 *
 * PATCH EXISTS HERE, unlike everywhere else in this module, and that is not an
 * inconsistency. A category is CONFIGURATION, not a transaction: renaming
 * "Cleaning" to "Cleaning & Waste" changes a label, and §70's "never delete a
 * transaction" does not apply to a label. What the update route still refuses is
 * `kind` — see the service for why a category cannot change sides of the books.
 *
 * DELETE also exists, and is deliberately narrow: it succeeds only for a
 * category no document has ever referenced. The moment one has, it returns 409
 * telling the caller to deactivate instead — deleting it would orphan last
 * year's totals.
 *
 * PERMISSIONS: reading takes FINANCIAL_CATEGORY_READ, held by every financial
 * role including AUDITOR. Writing takes FINANCIAL_CATEGORY_MANAGE, which the
 * auditor and the board do NOT hold: the chart of accounts shapes every report,
 * and an auditor who can reshape the categories they audit is not an auditor.
 */
@ApiTags('finance')
@Controller('buildings/:buildingId/financial-categories')
@ScopedTo('building')
export class FinancialCategoriesController {
  constructor(private readonly categories: FinancialCategoriesService) {}

  @RequirePermissions(PERMISSIONS.FINANCIAL_CATEGORY_READ)
  @Get()
  @ApiOperation({ summary: 'فهرست دسته‌بندی‌های مالی ساختمان' })
  async list(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Query() query: ListFinancialCategoriesQueryDto,
  ): Promise<FinancialCategoryResponse[]> {
    return this.categories.list(scope, query);
  }

  @RequirePermissions(PERMISSIONS.FINANCIAL_CATEGORY_MANAGE)
  @Post()
  @ApiOperation({ summary: 'ایجاد دسته‌بندی مالی' })
  async create(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: CreateFinancialCategoryDto,
  ): Promise<FinancialCategoryResponse> {
    return this.categories.create(scope, dto);
  }

  /** Renames, reorders or retires. Cannot change `kind` — see the service. */
  @RequirePermissions(PERMISSIONS.FINANCIAL_CATEGORY_MANAGE)
  @Patch(':categoryId')
  @ApiOperation({ summary: 'ویرایش یا غیرفعال‌سازی دسته‌بندی مالی' })
  async update(
    @Param('buildingId') _buildingId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: UpdateFinancialCategoryDto,
  ): Promise<FinancialCategoryResponse> {
    return this.categories.update(scope, categoryId, dto);
  }

  /**
   * Removes a never-used category. Returns 409 the moment any expense or income
   * references it, pointing the caller at deactivation instead.
   */
  @RequirePermissions(PERMISSIONS.FINANCIAL_CATEGORY_MANAGE)
  @Delete(':categoryId')
  @HttpCode(204)
  @ApiOperation({ summary: 'حذف دسته‌بندی استفاده‌نشده' })
  async remove(
    @Param('buildingId') _buildingId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<void> {
    return this.categories.remove(scope, categoryId);
  }
}
