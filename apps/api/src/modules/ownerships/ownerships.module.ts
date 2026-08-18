import { Module } from '@nestjs/common';

import { OwnershipsController } from './ownerships.controller';
import { OwnershipsService } from './ownerships.service';

/**
 * BM-01 §18/§19 — temporal legal title over units, and the API expression of
 * R2 ("record history, never overwrite it").
 *
 * This module is what makes a sale a pair of events rather than an edit: the
 * seller's period closes and the buyer's opens, so "who owned flat 12 in Mehr
 * 1402" stays answerable forever.
 *
 * Exported because BM-03 billing decides WHO a charge is raised against by
 * asking this service who held title during the charge period — that lookup
 * must go through here so the half-open interval semantics and the share rules
 * are applied identically everywhere.
 */
@Module({
  controllers: [OwnershipsController],
  providers: [OwnershipsService],
  exports: [OwnershipsService],
})
export class OwnershipsModule {}
