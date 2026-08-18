import { Module } from '@nestjs/common';

import {
  BuildingsController,
  OrganizationBuildingsController,
} from './buildings.controller';
import { BuildingsService } from './buildings.service';

/**
 * BM-01 building tier — the permanent operational entity.
 *
 * TWO controllers, one service, on purpose: `OrganizationBuildingsController`
 * is organization-scoped (create/list, before a building exists to scope to)
 * and `BuildingsController` is building-scoped. Keeping them apart means each
 * class carries exactly one @ScopedTo, so no route can silently inherit the
 * wrong tenancy level.
 *
 * The service is exported for UnitsModule, which must resolve a building's
 * currency/timezone and confirm it is mutable before creating units in it.
 */
@Module({
  controllers: [OrganizationBuildingsController, BuildingsController],
  providers: [BuildingsService],
  exports: [BuildingsService],
})
export class BuildingsModule {}
