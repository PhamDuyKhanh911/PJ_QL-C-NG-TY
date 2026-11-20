import { Body, Controller, Get, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { ChannelsService } from './channels.service';
import { UpdateChannelConnectionDto } from './dto/update-channel-connection.dto';
import { ChannelOAuthService } from './channel-oauth.service';
import { ChannelOrderSyncService } from './channel-order-sync.service';
import { assertChannelScope, assertOrganizationScope, resolveDataScope } from '../auth/data-scope';

@Controller('channels')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChannelsController {
  constructor(private readonly channels: ChannelsService, private readonly orderSync: ChannelOrderSyncService) {}

  @Get() @RequirePermissions('channels.read')
  list(@CurrentUser() user: AuthenticatedUser) { return this.channels.list(user.organizationId, resolveDataScope(user, 'channels.read')); }

  @Get('sync-summary') @RequirePermissions('channels.read')
  summary(@CurrentUser() user: AuthenticatedUser) { return this.channels.syncSummary(user.organizationId, resolveDataScope(user, 'channels.read')); }

  @Get('inventory-reconciliation') @RequirePermissions('inventory.read')
  inventoryReconciliation(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.channels.inventoryReconciliation(user.organizationId, resolveDataScope(user, 'inventory.read'), status);
  }

  @Post('inventory-reconciliation/:id/resync') @RequirePermissions('channels.sync')
  resyncInventoryReconciliation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.channels.resyncInventoryReconciliation(user.organizationId, user.id, id, resolveDataScope(user, 'channels.sync'));
  }

  @Get(':id/connection') @RequirePermissions('channels.read')
  connection(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { const scope = resolveDataScope(user, 'channels.read'); assertChannelScope(scope, id); return this.channels.getConnection(user.organizationId, id); }

  @Put(':id/connection') @RequirePermissions('channels.manage')
  saveConnection(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: UpdateChannelConnectionDto) {
    assertChannelScope(resolveDataScope(user, 'channels.manage'), id);
    return this.channels.saveConnection(user.organizationId, user.id, id, input);
  }

  @Post(':id/connection/check') @RequirePermissions('channels.manage')
  checkConnection(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    assertChannelScope(resolveDataScope(user, 'channels.manage'), id);
    return this.channels.checkConnection(user.organizationId, id);
  }

  @Post(':id/connection/refresh-token') @RequirePermissions('channels.manage')
  refreshToken(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    assertChannelScope(resolveDataScope(user, 'channels.manage'), id);
    return this.channels.refreshToken(user.organizationId, id);
  }

  @Post(':id/oauth/start') @RequirePermissions('channels.manage')
  startOAuth(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    assertChannelScope(resolveDataScope(user, 'channels.manage'), id);
    return this.channels.startOAuth(user.organizationId, user.id, id);
  }

  @Post('process-pending') @RequirePermissions('channels.sync')
  processPending(@CurrentUser() user: AuthenticatedUser) { assertOrganizationScope(resolveDataScope(user, 'channels.sync')); return this.channels.processPending(user.organizationId, user.id); }

  @Post(':id/sync-inventory') @RequirePermissions('channels.sync')
  sync(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { assertChannelScope(resolveDataScope(user, 'channels.sync'), id); return this.channels.syncInventory(user.organizationId, id, user.id); }

  @Post(':id/sync-orders') @RequirePermissions('channels.sync')
  syncOrders(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { assertChannelScope(resolveDataScope(user, 'channels.sync'), id); return this.orderSync.sync(user.organizationId, id, user.id); }
}

@Controller('channels/oauth')
export class ChannelOAuthController {
  constructor(private readonly oauth: ChannelOAuthService) {}

  @Get('callback/:channelId')
  async callback(
    @Param('channelId') channelId: string,
    @Query('state') state: string | undefined,
    @Query('code') code: string | undefined,
    @Query('auth_code') authCode: string | undefined,
    @Query('shop_id') shopId: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() response: Response,
  ) {
    const result = await this.oauth.complete(channelId, { state, code, authCode, shopId, error, errorDescription });
    return response.redirect(302, result.redirectUrl);
  }
}
