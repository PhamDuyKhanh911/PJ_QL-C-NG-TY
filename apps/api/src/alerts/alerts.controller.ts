import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AlertsService } from './alerts.service';
import { ListAlertsDto } from './dto/list-alerts.dto';
import { UpdateAlertStatusDto } from './dto/update-alert-status.dto';
import { resolveDataScope } from '../auth/data-scope';

@Controller('alerts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  @RequirePermissions('alerts.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListAlertsDto) {
    return this.alerts.list(user.organizationId, query, resolveDataScope(user, 'alerts.read'), user.id);
  }

  @Patch(':alertId/status')
  @RequirePermissions('alerts.manage')
  updateStatus(@CurrentUser() user: AuthenticatedUser, @Param('alertId') alertId: string, @Body() input: UpdateAlertStatusDto) {
    return this.alerts.updateStatus(user.organizationId, user.id, alertId, input, resolveDataScope(user, 'alerts.manage'));
  }
}
