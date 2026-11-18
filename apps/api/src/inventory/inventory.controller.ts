import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { InventoryService } from './inventory.service';

@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}
  @Get('alerts') @RequirePermissions('inventory.read')
  alerts(@CurrentUser() user: AuthenticatedUser) { return this.inventory.alerts(user.organizationId); }
  @Post('adjustments') @RequirePermissions('inventory.adjust')
  adjust(@CurrentUser() user: AuthenticatedUser, @Body() input: AdjustInventoryDto) { return this.inventory.adjust(user.organizationId, user.id, input); }
}

