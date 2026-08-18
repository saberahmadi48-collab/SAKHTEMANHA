import { Module } from '@nestjs/common';

import { OccupanciesController } from './occupancies.controller';
import { OccupanciesService } from './occupancies.service';

/**
 * BM-01 §20 — temporal physical occupancy of units.
 *
 * Kept separate from OwnershipsModule because the biller and the resident are
 * frequently different people, and BM-03 splits charges on exactly that line:
 * fixed charges follow title, consumption charges follow whoever actually lived
 * there. One combined "who is attached to this unit" model would make a
 * landlord's water bill unattributable.
 *
 * Exported because BM-03 billing asks this service who occupied a unit during a
 * charge period, and that lookup must go through here so the one-occupancy-per-
 * instant rule and the half-open interval semantics apply identically.
 */
@Module({
  controllers: [OccupanciesController],
  providers: [OccupanciesService],
  exports: [OccupanciesService],
})
export class OccupanciesModule {}
