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
import { PaymentsService } from './payments.service';
import {
  CreateProviderPaymentIntentDto,
  ListPaymentsQueryDto,
  RecordManualPaymentDto,
  ReversePaymentDto,
  VerifyProviderPaymentIntentDto,
  type PaymentResponse,
  type ProviderPaymentIntentResponse,
} from './dto/payment.dto';

/**
 * Payments — `/api/buildings/{id}/payments` (BM-03 §25-§29, §36, §46).
 *
 * NO PUT, NO PATCH, NO DELETE, for the strongest version of the reason that
 * applies elsewhere in this module: §70 states Deleted Transaction ≠ Correction.
 * A payment recorded for the wrong amount or against the wrong unit is undone by
 * `POST :paymentId/reverse`, which writes the opposing ledger entry and leaves
 * both the money and its undoing visible. An editable payment amount would let
 * someone quietly rewrite what a resident paid.
 *
 * PERMISSIONS, and the asymmetry is the point: reading takes PAYMENT_READ, which
 * auditors and board members hold. Recording and reversing take PAYMENT_RECORD,
 * which AUDITOR deliberately does NOT have (§62) — an auditor who can enter
 * payments into the books they audit is not an auditor.
 *
 * §36's "elevated permission" for manual entry is exactly PAYMENT_RECORD, held
 * only by the building manager and org billing. There is no gateway route here:
 * §69 assigns provider integration to BM-04, and it will arrive through the §31
 * abstraction rather than as a second endpoint bolted on beside this one.
 */
@ApiTags('finance')
@Controller('buildings/:buildingId/payments')
@ScopedTo('building')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @RequirePermissions(PERMISSIONS.PAYMENT_READ)
  @Get()
  @ApiOperation({ summary: 'فهرست پرداخت‌های ساختمان' })
  async list(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<PaymentResponse[]> {
    return this.payments.list(scope, query);
  }

  @RequirePermissions(PERMISSIONS.PAYMENT_READ)
  @Get(':paymentId')
  @ApiOperation({ summary: 'جزئیات یک پرداخت' })
  async findOne(
    @Param('buildingId') _buildingId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<PaymentResponse> {
    return this.payments.findOne(scope, paymentId);
  }

  /**
   * §36 — the controlled manual fallback: cash, bank transfer or POS receipt the
   * manager records by hand. Settles the invoice if one is named, and turns any
   * excess into unit credit rather than discarding it (§26).
   */
  @RequirePermissions(PERMISSIONS.PAYMENT_RECORD)
  @Post()
  @ApiOperation({ summary: 'ثبت دستی پرداخت دریافتی' })
  async recordManual(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: RecordManualPaymentDto,
  ): Promise<PaymentResponse> {
    return this.payments.recordManual(scope, dto);
  }

  @RequirePermissions(PERMISSIONS.PAYMENT_RECORD)
  @Post('provider-intents')
  @ApiOperation({ summary: 'ایجاد intent پرداخت درگاه' })
  async createProviderIntent(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: CreateProviderPaymentIntentDto,
  ): Promise<ProviderPaymentIntentResponse> {
    return this.payments.createProviderIntent(scope, dto);
  }

  @RequirePermissions(PERMISSIONS.PAYMENT_RECORD)
  @Post('provider-intents/verify')
  @ApiOperation({ summary: 'تأیید پرداخت از طریق درگاه' })
  async verifyProviderIntent(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: VerifyProviderPaymentIntentDto,
  ): Promise<ProviderPaymentIntentResponse> {
    return this.payments.verifyProviderIntent(scope, dto);
  }

  /** §46 — a bounced cheque or mis-keyed receipt. The row survives as REVERSED. */
  @RequirePermissions(PERMISSIONS.PAYMENT_RECORD)
  @Post(':paymentId/reverse')
  @ApiOperation({ summary: 'برگشت پرداخت با ذکر دلیل' })
  async reverse(
    @Param('buildingId') _buildingId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: ReversePaymentDto,
  ): Promise<PaymentResponse> {
    return this.payments.reverse(scope, paymentId, dto);
  }
}
