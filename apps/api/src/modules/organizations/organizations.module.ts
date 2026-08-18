import { Module } from '@nestjs/common';

import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

/**
 * BM-01 organization tier — the tenant root.
 *
 * No providers are declared for PrismaService / AuditService: CoreModule is
 * @Global, so they are injected without being re-registered here. Re-declaring
 * them would create a SECOND PrismaService instance with its own connection
 * pool and its own `$on('query')` listener, which is a subtle resource leak
 * rather than an obvious error.
 *
 * The service is exported because BuildingsModule needs it to read an
 * organization's locale/currency/timezone defaults when creating a building.
 */
@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
