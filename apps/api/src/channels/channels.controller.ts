import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { ChannelsService } from './channels.service';
import { UpdateChannelConnectionDto } from './dto/update-channel-connection.dto';

@Controller('channels')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get() @RequirePermissions('channels.read')
  list(@CurrentUser() user: AuthenticatedUser) { return this.channels.list(user.organizationId); }

  @Get('sync-summary') @RequirePermissions('channels.read')
  summary(@CurrentUser() user: AuthenticatedUser) { return this.channels.syncSummary(user.organizationId); }

  @Get(':id/connection') @RequirePermissions('channels.read')
  connection(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.channels.getConnection(user.organizationId, id); }

  @Put(':id/connection') @RequirePermissions('channels.manage')
  saveConnection(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: UpdateChannelConnectionDto) {
    return this.channels.saveConnection(user.organizationId, user.id, id, input);
  }

  @Post(':id/connection/check') @RequirePermissions('channels.manage')
  checkConnection(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.channels.checkConnection(user.organizationId, id);
  }

  @Post(':id/connection/refresh-token') @RequirePermissions('channels.manage')
  refreshToken(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.channels.refreshToken(user.organizationId, id);
  }

  @Post('process-pending') @RequirePermissions('channels.sync')
  processPending(@CurrentUser() user: AuthenticatedUser) { return this.channels.processPending(user.organizationId, user.id); }

  @Post(':id/sync-inventory') @RequirePermissions('channels.sync')
  sync(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.channels.syncInventory(user.organizationId, id, user.id); }
}
