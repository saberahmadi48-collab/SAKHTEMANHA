import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Authentication module (BM-01 §32, step 1 of onboarding).
 *
 * `JwtModule.register({})` is intentionally EMPTY. Access and refresh tokens are
 * signed with DIFFERENT secrets — reusing one would let a stolen refresh token
 * be replayed as an access token — so a module-level default secret would be
 * either wrong for one of them or a silent fallback nobody notices. AuthService
 * passes the correct secret and TTL explicitly on every sign and verify.
 *
 * PrismaService and AuditService are not imported here: CoreModule is @Global.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
