import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { InspectQuarantineDto } from './dto/inspect-quarantine.dto';
import { ListInventoryTransactionsDto } from './dto/list-inventory-transactions.dto';
import { InventoryService } from './inventory.service';
import { resolveDataScope } from '../auth/data-scope';
import { CreateStocktakeDto } from './dto/create-stocktake.dto';
import { UpdateStocktakeItemDto } from './dto/update-stocktake-item.dto';
import { InitializeInventoryDto } from './dto/initialize-inventory.dto';

@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}
  @Get('alerts') @RequirePermissions('inventory.read')
  alerts(@CurrentUser() user: AuthenticatedUser) { return this.inventory.alerts(user.organizationId, resolveDataScope(user, 'inventory.read')); }
  @Post('adjustments') @RequirePermissions('inventory.adjust')
  adjust(@CurrentUser() user: AuthenticatedUser, @Body() input: AdjustInventoryDto) { return this.inventory.adjust(user.organizationId, user.id, input, resolveDataScope(user, 'inventory.adjust')); }
  @Post('initial-stock') @RequirePermissions('inventory.initialize')
  initializeStock(@CurrentUser() user: AuthenticatedUser, @Body() input: InitializeInventoryDto) { return this.inventory.initializeStock(user.organizationId, user.id, input, resolveDataScope(user, 'inventory.initialize')); }
  @Get('quarantine') @RequirePermissions('inventory.read')
  quarantine(@CurrentUser() user: AuthenticatedUser) { return this.inventory.quarantine(user.organizationId, resolveDataScope(user, 'inventory.read')); }
  @Post('quarantine/inspect') @RequirePermissions('inventory.inspect_returns')
  inspect(@CurrentUser() user: AuthenticatedUser, @Body() input: InspectQuarantineDto) { return this.inventory.inspectQuarantine(user.organizationId, user.id, input, resolveDataScope(user, 'inventory.inspect_returns')); }
  @Get('transactions') @RequirePermissions('inventory.read')
  transactions(@CurrentUser() user: AuthenticatedUser, @Query() query: ListInventoryTransactionsDto) { return this.inventory.transactions(user.organizationId, query, resolveDataScope(user, 'inventory.read')); }
  @Get('warehouses') @RequirePermissions('inventory.read')
  warehouses(@CurrentUser() user: AuthenticatedUser) { return this.inventory.warehouses(user.organizationId, resolveDataScope(user, 'inventory.read')); }
  @Get('stocktakes') @RequirePermissions('inventory.read')
  stocktakes(@CurrentUser() user: AuthenticatedUser) { return this.inventory.stocktakes(user.organizationId, resolveDataScope(user, 'inventory.read')); }
  @Get('stocktakes/:id') @RequirePermissions('inventory.read')
  stocktake(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.inventory.stocktake(user.organizationId, id, resolveDataScope(user, 'inventory.read')); }
  @Post('stocktakes') @RequirePermissions('inventory.count')
  createStocktake(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateStocktakeDto) { return this.inventory.createStocktake(user.organizationId, user.id, input, resolveDataScope(user, 'inventory.count')); }
  @Patch('stocktakes/:id/items/:itemId') @RequirePermissions('inventory.count')
  updateStocktakeItem(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('itemId') itemId: string, @Body() input: UpdateStocktakeItemDto) { return this.inventory.updateStocktakeItem(user.organizationId, id, itemId, input, resolveDataScope(user, 'inventory.count')); }
  @Post('stocktakes/:id/finalize') @RequirePermissions('inventory.count')
  finalizeStocktake(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.inventory.finalizeStocktake(user.organizationId, user.id, id, resolveDataScope(user, 'inventory.count')); }
  @Post('stocktakes/:id/cancel') @RequirePermissions('inventory.count')
  cancelStocktake(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.inventory.cancelStocktake(user.organizationId, user.id, id, resolveDataScope(user, 'inventory.count')); }
}
