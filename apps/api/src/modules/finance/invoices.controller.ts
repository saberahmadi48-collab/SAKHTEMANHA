import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { InvoicesService } from './invoices.service';
import {
  CancelInvoiceDto,
  IssueInvoicesDto,
  ListInvoicesQueryDto,
  type InvoiceResponse,
  type IssueInvoicesResponse,
} from './dto/invoice.dto';

/**
 * Invoices — `/api/buildings/{id}/invoices` (BM-03 §21-§25).
 *
 * Nested under `:buildingId` like every other building resource, so
 * BuildingScopeGuard proves the tenant from the URL before a handler runs and an
 * invoice id from another building is unreachable (§64).
 *
 * NO PUT, NO PATCH, NO DELETE — the same deliberate absence as charge rules, for
 * a related reason. §24 states a paid invoice must not simply be deleted, and an
 * invoice is a DOCUMENT: one whose figures can be edited after issue is not
 * evidence of anything. A wrong invoice is cancelled (`POST :invoiceId/cancel`),
 * which keeps the row, keeps its number so the §23 sequence stays gap-free, and
 * releases its charges to be billed correctly on a new document.
 *
 * PERMISSIONS: reading uses INVOICE_READ (managers, board, auditors); issuing
 * and cancelling use INVOICE_ISSUE. Cancellation deliberately does NOT require a
 * separate permission — it is the correction path for a mis-issue, and gating it
 * higher than issuing would leave the person who made the mistake unable to fix
 * it.
 */
@ApiTags('finance')
@Controller('buildings/:buildingId/invoices')
@ScopedTo('building')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @RequirePermissions(PERMISSIONS.INVOICE_READ)
  @Get()
  @ApiOperation({ summary: 'فهرست صورت‌حساب‌های ساختمان' })
  async list(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Query() query: ListInvoicesQueryDto,
  ): Promise<InvoiceResponse[]> {
    return this.invoices.list(scope, query);
  }

  @RequirePermissions(PERMISSIONS.INVOICE_READ)
  @Get(':invoiceId')
  @ApiOperation({ summary: 'جزئیات صورت‌حساب همراه سطرها' })
  async findOne(
    @Param('buildingId') _buildingId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<InvoiceResponse> {
    return this.invoices.findOne(scope, invoiceId);
  }

  /**
   * §50 — the step after charge generation: turn this month's charges into
   * payable documents, one per unit, with no per-resident data entry.
   */
  @RequirePermissions(PERMISSIONS.INVOICE_ISSUE)
  @Post()
  @ApiOperation({ summary: 'صدور صورت‌حساب از شارژهای دوره' })
  async issue(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: IssueInvoicesDto,
  ): Promise<IssueInvoicesResponse> {
    return this.invoices.issue(scope, dto);
  }

  /** §24 — the correction path. The document survives; its charges are released. */
  @RequirePermissions(PERMISSIONS.INVOICE_ISSUE)
  @Post(':invoiceId/cancel')
  @ApiOperation({ summary: 'ابطال صورت‌حساب با ذکر دلیل' })
  async cancel(
    @Param('buildingId') _buildingId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: CancelInvoiceDto,
  ): Promise<InvoiceResponse> {
    return this.invoices.cancel(scope, invoiceId, dto);
  }
}
