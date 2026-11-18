import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { PurchasingService } from './purchasing.service';

@Controller('purchasing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}
  @Get('suppliers') @RequirePermissions('purchasing.read') suppliers(@CurrentUser() user: AuthenticatedUser) { return this.purchasing.suppliers(user.organizationId); }
  @Get('suggestions') @RequirePermissions('purchasing.read') suggestions(@CurrentUser() user: AuthenticatedUser) { return this.purchasing.suggestions(user.organizationId); }
  @Get('orders') @RequirePermissions('purchasing.read') orders(@CurrentUser() user: AuthenticatedUser) { return this.purchasing.orders(user.organizationId); }
  @Post('orders') @RequirePermissions('purchasing.manage') create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreatePurchaseOrderDto) { return this.purchasing.create(user.organizationId, user.id, input); }
  @Post('orders/:id/receive') @RequirePermissions('purchasing.receive') receive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: ReceivePurchaseOrderDto) { return this.purchasing.receive(user.organizationId, user.id, id, input); }
}
