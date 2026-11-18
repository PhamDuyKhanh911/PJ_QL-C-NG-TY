import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { FulfillmentActionDto } from './dto/fulfillment-action.dto';
import { FulfillmentService } from './fulfillment.service';

@Controller('fulfillment')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FulfillmentController {
  constructor(private readonly fulfillment: FulfillmentService) {}
  @Get('orders') @RequirePermissions('fulfillment.read') list(@CurrentUser() user: AuthenticatedUser) { return this.fulfillment.list(user.organizationId); }
  @Get('handlers') @RequirePermissions('sales.read') handlers(@CurrentUser() user: AuthenticatedUser) { return this.fulfillment.handlers(user.organizationId); }
  @Post('orders/:id/dispatch') @RequirePermissions('fulfillment.dispatch') dispatch(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: FulfillmentActionDto) { return this.fulfillment.dispatch(user.organizationId, user.id, id, input); }
}
