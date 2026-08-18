import { Module } from '@nestjs/common';

import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';

/**
 * BM-01 unit tier — the chargeable spaces inside a building.
 *
 * Exported because BM-02 (ownership/occupancy) and BM-03 (charge generation)
 * both need to resolve a unit within a proven building scope, and both must go
 * through this service rather than querying `unit` directly — it is the only
 * place the tenant predicate is guaranteed to be applied.
 */
@Module({
  controllers: [UnitsController],
  providers: [UnitsService],
  exports: [UnitsService],
})
export class UnitsModule {}
