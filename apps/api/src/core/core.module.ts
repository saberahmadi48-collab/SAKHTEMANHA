import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';

import { AuditService } from './audit/audit.service';
import { PrismaService } from './database/prisma.service';
import { ScopeService } from './authorization/scope.service';
import { JwtStrategy } from './authorization/jwt.strategy';
import { JwtAuthGuard } from './authorization/jwt-auth.guard';
import { BuildingScopeGuard } from './authorization/building-scope.guard';

/**
 * Cross-cutting infrastructure shared by every feature module.
 *
 * GUARD ORDER IS LOAD-BEARING. Nest applies APP_GUARD providers in registration
 * order, so JwtAuthGuard (who are you?) must precede BuildingScopeGuard (what
 * may you touch?) — the latter reads the `request.user` the former sets.
 * Registering both globally means a new controller is authenticated AND
 * tenant-scoped by default; opting out is explicit and reviewable
 * (@Public / @ScopedTo('none')).
 */
@Global()
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
  providers: [
    PrismaService,
    AuditService,
    ScopeService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: BuildingScopeGuard },
  ],
  exports: [PrismaService, AuditService, ScopeService],
})
export class CoreModule {}
