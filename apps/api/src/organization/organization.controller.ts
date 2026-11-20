import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { resolveDataScope } from '../auth/data-scope';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { OrganizationService } from './organization.service';

@Controller('organization')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrganizationController {
  constructor(private readonly organizations: OrganizationService) {}
  @Get('overview')
  @RequirePermissions('organization.read')
  overview(@CurrentUser() user: AuthenticatedUser) { return this.organizations.getOverview(user.organizationId, resolveDataScope(user, 'organization.read')); }
}
