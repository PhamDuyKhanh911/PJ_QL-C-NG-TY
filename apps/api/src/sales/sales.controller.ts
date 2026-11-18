import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersDto } from './dto/list-orders.dto';
import { SalesService } from './sales.service';
import { SyncMarketplaceOrderDto } from './dto/sync-marketplace-order.dto';

@Controller('sales')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesController {
  constructor(private readonly sales: SalesService) {}
  @Get('orders') @RequirePermissions('sales.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListOrdersDto) { return this.sales.list(user.organizationId, query); }
  @Post('orders') @RequirePermissions('sales.create')
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateOrderDto) { return this.sales.create(user.organizationId, user.id, input); }
  @Post('orders/sync-marketplace') @RequirePermissions('channels.sync')
  syncMarketplace(@CurrentUser() user: AuthenticatedUser, @Body() input: SyncMarketplaceOrderDto) { return this.sales.syncMarketplace(user.organizationId, user.id, input); }
  @Post('orders/:id/cancel') @RequirePermissions('sales.cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: CancelOrderDto) { return this.sales.cancel(user.organizationId, user.id, id, input); }
  @Get('metrics') @RequirePermissions('reports.sales')
  metrics(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) { return this.sales.metrics(user.organizationId, from, to); }
}
