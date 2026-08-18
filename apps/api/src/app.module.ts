import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { validateEnv } from './config/env.validation';
import { CoreModule } from './core/core.module';
import { AuthModule } from './modules/auth/auth.module';
import { BuildingsModule } from './modules/buildings/buildings.module';
import { FinanceModule } from './modules/finance/finance.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { ManagementTermsModule } from './modules/management-terms/management-terms.module';
import { MembersModule } from './modules/members/members.module';
import { OccupanciesModule } from './modules/occupancies/occupancies.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { OwnershipsModule } from './modules/ownerships/ownerships.module';
import { ProfileModule } from './modules/profile/profile.module';
import { UnitsModule } from './modules/units/units.module';

/**
 * Application root.
 *
 * Feature modules are added here one BM phase at a time, in the agreed order.
 * The modular-monolith shape is intentional: every module owns its
 * controllers/services/repositories and talks to others through their public
 * service, so any of them can be extracted into a separate deployable later
 * without rewriting call sites.
 *
 * AuthModule comes FIRST and is not optional: every global guard resolves a
 * caller from a JWT, and nothing in the platform mints one until this module
 * exists. BM-01 §32 says the same thing in product terms — onboarding starts at
 * "create account".
 *
 * BM-01 is wired in dependency order — Organization owns Building owns Unit —
 * which is also the onboarding order of §32. Nest resolves providers by graph,
 * not by array position, so this order is for the reader; what it does buy is
 * that a missing tier is obvious at a glance.
 *
 * Wiring order to come:
 *   BM-04  PaymentsModule
 *   BM-05  MaintenanceModule + ProvidersModule
 *   BM-06  GovernanceModule
 *   BM-07  NotificationsModule + DocumentsModule
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Fail fast on bad configuration rather than at the first request.
      validate: validateEnv,
    }),
    // Baseline abuse protection. Auth routes tighten this further with their
    // own @Throttle() — credential stuffing is the realistic threat here.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    CoreModule,
    AuthModule,
    OrganizationsModule,
    BuildingsModule,
    UnitsModule,
    InvitationsModule,
    MembersModule,
    // Last of BM-01: terms depend on buildings existing and on members being
    // appointable, so it reads naturally after both.
    ManagementTermsModule,
    // Temporal attachment of people to units. Both need units to exist and
    // people to be members, so they read after MembersModule. Kept as two
    // modules rather than one because BM-03 bills them differently: fixed
    // charges follow title, consumption charges follow the occupant.
    OwnershipsModule,
    OccupanciesModule,

    // BM-02 §41. Listed last but depends on nothing above: profile routes carry
    // no tenant scope at all, so their position here is cosmetic rather than
    // load-bearing.
    ProfileModule,

    // BM-03. Reads unit area/share (BM-01) and title/occupancy (BM-02) as the
    // inputs to charge calculation, so it necessarily comes after both.
    FinanceModule,
  ],
  providers: [
    // ThrottlerGuard must be registered as a GLOBAL guard, not merely imported.
    // Importing ThrottlerModule alone configures the limits but enforces
    // nothing, which makes every @Throttle() on the auth routes decorative —
    // the rate limit silently does not exist. It is registered BEFORE the
    // core guards (which run in CoreModule's own registration order) so an
    // abusive client is rejected before it costs a database round trip.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
