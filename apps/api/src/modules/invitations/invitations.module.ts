import { Module } from '@nestjs/common';

import {
  BuildingInvitationsController,
  InvitationRedemptionController,
  OrganizationInvitationsController,
} from './invitations.controller';
import { InvitationsService } from './invitations.service';

/**
 * BM-01 §33/§34 — invitations, the only sanctioned path from "no access" to
 * "member".
 *
 * THREE CONTROLLERS, ONE SERVICE, and the split is deliberate: each controller
 * carries a different @ScopedTo level (organization / building / none), and
 * that metadata is read per-class by BuildingScopeGuard. Merging them into one
 * controller would force a single scope level onto routes whose entire security
 * difference IS the scope level.
 *
 * Exported because BM-06 (governance) issues board invitations when a term
 * begins, and must go through this service rather than writing membership rows
 * directly — the transactional accept path is what keeps an invitation and the
 * access it grants from ever drifting apart.
 */
@Module({
  controllers: [
    OrganizationInvitationsController,
    BuildingInvitationsController,
    InvitationRedemptionController,
  ],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
