import {
  Body,
  Controller,
  Get,
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
import { ExpensesService } from './expenses.service';
import {
  CreateExpenseDto,
  ListExpensesQueryDto,
  PayExpenseDto,
  RejectExpenseDto,
  UpdateExpenseDto,
  type ExpenseResponse,
} from './dto/expense.dto';

/**
 * Building expenses — `/api/buildings/{id}/expenses` (BM-03 §38/§39/§40).
 *
 * EACH STATE TRANSITION IS ITS OWN ROUTE WITH ITS OWN PERMISSION, rather than a
 * `status` field on a PATCH. That shape is what makes §39's approval authority
 * enforceable: a single `PATCH { status }` would need EXPENSE_APPROVE to guard
 * one value out of six, and the first caller who sent `status: "PAID"` directly
 * would skip both approval and the ledger post that must accompany it.
 *
 * THE PERMISSION SPLIT IS THE CONTROL (§39/§63):
 *   create/update/submit → EXPENSE_CREATE   (manager enters the bill)
 *   approve/reject       → EXPENSE_APPROVE  (board decides — manager lacks it)
 *   pay                  → EXPENSE_PAY      (manager executes the payment)
 *
 * The manager deliberately holds create and pay but NOT approve. On top of the
 * matrix, the service refuses self-approval outright, which is what covers the
 * ORG_ADMIN who legitimately holds both.
 *
 * THERE IS NO DELETE. An expense leaves the flow through `reject` (an approver
 * refused it) or `cancel` (the requester withdrew it), and a PAID one cannot
 * leave at all — money moved, and §70 forbids deleting a transaction. The
 * correction for a wrong payment is a ledger reversal.
 */
@ApiTags('finance')
@Controller('buildings/:buildingId/expenses')
@ScopedTo('building')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @RequirePermissions(PERMISSIONS.EXPENSE_READ)
  @Get()
  @ApiOperation({ summary: 'فهرست هزینه‌های ساختمان' })
  async list(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Query() query: ListExpensesQueryDto,
  ): Promise<ExpenseResponse[]> {
    return this.expenses.list(scope, query);
  }

  @RequirePermissions(PERMISSIONS.EXPENSE_READ)
  @Get(':expenseId')
  @ApiOperation({ summary: 'مشاهده یک هزینه' })
  async findOne(
    @Param('buildingId') _buildingId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<ExpenseResponse> {
    return this.expenses.findOne(scope, expenseId);
  }

  /** §38 — enters a supplier bill as DRAFT. No financial effect. */
  @RequirePermissions(PERMISSIONS.EXPENSE_CREATE)
  @Post()
  @ApiOperation({ summary: 'ثبت هزینه جدید (پیش‌نویس)' })
  async create(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: CreateExpenseDto,
  ): Promise<ExpenseResponse> {
    return this.expenses.create(scope, dto);
  }

  /** Editing is DRAFT-only: an approver reviewed specific figures. */
  @RequirePermissions(PERMISSIONS.EXPENSE_CREATE)
  @Patch(':expenseId')
  @ApiOperation({ summary: 'ویرایش هزینه پیش‌نویس' })
  async update(
    @Param('buildingId') _buildingId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: UpdateExpenseDto,
  ): Promise<ExpenseResponse> {
    return this.expenses.update(scope, expenseId, dto);
  }

  @RequirePermissions(PERMISSIONS.EXPENSE_CREATE)
  @Post(':expenseId/submit')
  @ApiOperation({ summary: 'ارسال هزینه برای تأیید' })
  async submit(
    @Param('buildingId') _buildingId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<ExpenseResponse> {
    return this.expenses.submit(scope, expenseId);
  }

  /**
   * §39 — approval. A DECISION, not a payment: nothing is posted to the ledger
   * here. Refused when the approver entered the expense themselves.
   */
  @RequirePermissions(PERMISSIONS.EXPENSE_APPROVE)
  @Post(':expenseId/approve')
  @ApiOperation({ summary: 'تأیید هزینه' })
  async approve(
    @Param('buildingId') _buildingId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<ExpenseResponse> {
    return this.expenses.approve(scope, expenseId);
  }

  @RequirePermissions(PERMISSIONS.EXPENSE_APPROVE)
  @Post(':expenseId/reject')
  @ApiOperation({ summary: 'رد هزینه با ذکر دلیل' })
  async reject(
    @Param('buildingId') _buildingId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: RejectExpenseDto,
  ): Promise<ExpenseResponse> {
    return this.expenses.reject(scope, expenseId, dto);
  }

  /**
   * §40 — the ONLY route in this controller with a ledger effect. Posts a
   * building-level DEBIT (`unitId: null`), which never touches a unit balance.
   */
  @RequirePermissions(PERMISSIONS.EXPENSE_PAY)
  @Post(':expenseId/pay')
  @ApiOperation({ summary: 'ثبت پرداخت هزینه و ثبت در دفتر کل' })
  async pay(
    @Param('buildingId') _buildingId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: PayExpenseDto,
  ): Promise<ExpenseResponse> {
    return this.expenses.pay(scope, expenseId, dto);
  }

  /** Withdrawal by the requester. Distinct from rejection — see the service. */
  @RequirePermissions(PERMISSIONS.EXPENSE_CREATE)
  @Post(':expenseId/cancel')
  @ApiOperation({ summary: 'انصراف از هزینه پیش از پرداخت' })
  async cancel(
    @Param('buildingId') _buildingId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<ExpenseResponse> {
    return this.expenses.cancel(scope, expenseId);
  }
}
