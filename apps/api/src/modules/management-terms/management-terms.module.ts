import { Module } from '@nestjs/common';

import { ManagementTermsController } from './management-terms.controller';
import { ManagementTermsService } from './management-terms.service';

/**
 * BM-01 §25/§26 — the management-term foundation, and the API expression of
 * BM-00 rule 1 ("the building is permanent, the manager is temporary").
 *
 * This module is what keeps `Building` free of a `managerId` column: the
 * current manager is DERIVED from the active term, and ScopeService reads that
 * derivation on every request. Authority therefore expires by itself when a
 * term ends, with no scheduled job to miss a run.
 *
 * Exported because BM-06 governance (elections, handover) concludes by opening
 * and closing terms, and BM-07 reporting needs "who governed on date X". Both
 * must go through this service so the overlap rule, the immutability of closed
 * terms, and the transactional role synchronisation apply identically.
 */
@Module({
  controllers: [ManagementTermsController],
  providers: [ManagementTermsService],
  exports: [ManagementTermsService],
})
export class ManagementTermsModule {}
