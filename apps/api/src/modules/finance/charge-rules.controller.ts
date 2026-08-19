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
import { ChargeRulesService } from './charge-rules.service';
import {
  ArchiveChargeRuleDto,
  CreateChargeRuleDto,
  ReviseChargeRuleDto,
  type ChargeRuleResponse,
} from './dto/charge-rule.dto';

/**
 * Charge rules — `/api/buildings/{id}/charge-rules` (BM-03 §12/§19/§52).
 *
 * Nested under `:buildingId` like every other building resource, so
 * BuildingScopeGuard proves the tenant from the URL before a handler runs and a
 * rule id from another building is unreachable (§64).
 *
 * THERE IS NO PUT AND NO PATCH, and that absence is the feature. §52 requires a
 * charge to stay reproducible from the rule that produced it, so a change is
 * `POST :ruleId/revise` — a NEW VERSION — never an edit of the row past charges
 * point at. Adding an update handler here would silently make historical
 * invoices unreproducible while every screen still looked correct.
 *
 * Likewise no DELETE: retiring is `POST :ruleId/archive`, which closes the
 * rule's effectivity and leaves the row for past charges to reference (R2).
 *
 * PERMISSIONS: reading uses CHARGE_READ (managers, board, auditors); writing
 * uses CHARGE_CREATE, which AUDITOR deliberately does not hold — an auditor who
 * can change the formula is not auditing it.
 */
@ApiTags('finance')
@Controller('buildings/:buildingId/charge-rules')
@ScopedTo('building')
export class ChargeRulesController {
  constructor(private readonly rules: ChargeRulesService) {}

  /**
   * Live rules by default; `includeSuperseded=true` adds the version history,
   * which is what an auditor needs to reconstruct why a past charge is the
   * number it is.
   */
  @RequirePermissions(PERMISSIONS.CHARGE_READ)
  @Get()
  @ApiOperation({ summary: 'فهرست قوانین شارژ ساختمان' })
  async list(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Query('includeSuperseded') includeSuperseded?: string,
  ): Promise<ChargeRuleResponse[]> {
    return this.rules.list(scope, {
      includeSuperseded: includeSuperseded === 'true',
    });
  }

  @RequirePermissions(PERMISSIONS.CHARGE_READ)
  @Get(':ruleId')
  @ApiOperation({ summary: 'جزئیات یک قانون شارژ' })
  async findOne(
    @Param('buildingId') _buildingId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<ChargeRuleResponse> {
    return this.rules.findOne(scope, ruleId);
  }

  @RequirePermissions(PERMISSIONS.CHARGE_CREATE)
  @Post()
  @ApiOperation({ summary: 'ساخت قانون شارژ تازه' })
  async create(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: CreateChargeRuleDto,
  ): Promise<ChargeRuleResponse> {
    return this.rules.create(scope, dto);
  }

  /** §52 — the only way to change a rule: supersede it with version + 1. */
  @RequirePermissions(PERMISSIONS.CHARGE_CREATE)
  @Post(':ruleId/revise')
  @ApiOperation({ summary: 'ساخت نسخه تازه از قانون شارژ' })
  async revise(
    @Param('buildingId') _buildingId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: ReviseChargeRuleDto,
  ): Promise<ChargeRuleResponse> {
    return this.rules.revise(scope, ruleId, dto);
  }

  /** Retires a rule without destroying what past charges point at (R2). */
  @RequirePermissions(PERMISSIONS.CHARGE_CREATE)
  @Post(':ruleId/archive')
  @ApiOperation({ summary: 'بایگانی قانون شارژ' })
  async archive(
    @Param('buildingId') _buildingId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: ArchiveChargeRuleDto,
  ): Promise<ChargeRuleResponse> {
    return this.rules.archive(scope, ruleId, dto);
  }
}
