import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';import { CurrentUser } from '../auth/current-user.decorator';import { JwtAuthGuard } from '../auth/jwt-auth.guard';import { RequirePermissions } from '../auth/permissions.decorator';import { PermissionsGuard } from '../auth/permissions.guard';
import { SyncSettlementsDto } from './dto/sync-settlements.dto';import { ReconciliationService } from './reconciliation.service';
@Controller('reconciliation') @UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReconciliationController { constructor(private readonly reconciliation: ReconciliationService) {}
  @Get('summary') @RequirePermissions('reconciliation.read') summary(@CurrentUser() user: AuthenticatedUser) { return this.reconciliation.summary(user.organizationId); }
  @Post('sync') @RequirePermissions('reconciliation.sync') sync(@CurrentUser() user: AuthenticatedUser, @Body() input: SyncSettlementsDto) { return this.reconciliation.sync(user.organizationId, user.id, input); }
}
