import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { FulfillmentActionDto } from './dto/fulfillment-action.dto';
import { BatchDispatchDto } from './dto/batch-dispatch.dto';
import { FulfillmentService } from './fulfillment.service';

@Controller('fulfillment')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FulfillmentController {
  constructor(private readonly fulfillment: FulfillmentService) {}
  @Get('orders') @RequirePermissions('fulfillment.read') list(@CurrentUser() user: AuthenticatedUser) { return this.fulfillment.list(user.organizationId); }
  @Get('batches/:batchCode') @RequirePermissions('fulfillment.read') batchDetail(@CurrentUser() user: AuthenticatedUser, @Param('batchCode') batchCode: string) { return this.fulfillment.batchDetail(user.organizationId, batchCode); }
  @Get('orders/:id') @RequirePermissions('fulfillment.read') detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.fulfillment.detail(user.organizationId, id); }
  @Get('handlers') @RequirePermissions('sales.read') handlers(@CurrentUser() user: AuthenticatedUser) { return this.fulfillment.handlers(user.organizationId, user.id); }
  @Post('orders/:id/dispatch') @RequirePermissions('fulfillment.dispatch') dispatch(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: FulfillmentActionDto) { return this.fulfillment.dispatch(user.organizationId, user.id, id, input); }
  @Post('batch-dispatch') @RequirePermissions('fulfillment.dispatch') batchDispatch(@CurrentUser() user: AuthenticatedUser, @Body() input: BatchDispatchDto) { return this.fulfillment.batchDispatch(user.organizationId, user.id, input); }
}
