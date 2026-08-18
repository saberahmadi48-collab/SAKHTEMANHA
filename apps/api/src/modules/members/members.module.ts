import { Module } from '@nestjs/common';

import {
  BuildingMembersController,
  OrganizationMembersController,
} from './members.controller';
import { MembersService } from './members.service';

/**
 * BM-01 §33 — membership administration, the read/write side of the
 * authorization rows ScopeService resolves on every request.
 *
 * Two controllers because the two tiers carry different @ScopedTo levels; one
 * service because the invariants (last-owner protection, no privilege
 * escalation, contact masking) must hold identically regardless of which route
 * the request arrived through.
 *
 * Exported for BM-06 governance: electing a board writes BuildingMembership
 * rows bound to a ManagementTerm, and that must go through this service so the
 * same guards apply.
 */
@Module({
  controllers: [BuildingMembersController, OrganizationMembersController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
