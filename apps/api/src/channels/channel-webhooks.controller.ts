import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { ChannelWebhookService } from './channel-webhook.service';
import { ListChannelWebhookEventsDto } from './dto/list-channel-webhook-events.dto';

type RawRequest = Request & { rawBody?: Buffer };

@Controller('channels/webhooks')
export class ChannelWebhooksController {
  constructor(private readonly webhooks: ChannelWebhookService) {}

  @Get(':channelId')
  verify(
    @Param('channelId') channelId: string,
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    return this.webhooks.verifyFacebookChallenge(channelId, mode, token, challenge);
  }

  @Post(':channelId')
  @HttpCode(202)
  receive(
    @Param('channelId') channelId: string,
    @Req() request: RawRequest,
    @Body() body: unknown,
    @Headers('x-hub-signature-256') facebookSignature?: string,
    @Headers('x-channel-signature') channelSignature?: string,
    @Headers('x-event-id') providerEventId?: string,
  ) {
    const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(body));
    return this.webhooks.receive(channelId, rawBody, body, { facebook: facebookSignature, channel: channelSignature, providerEventId });
  }
}

@Controller('channels/integration-events')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChannelIntegrationEventsController {
  constructor(private readonly webhooks: ChannelWebhookService) {}

  @Get()
  @RequirePermissions('channels.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListChannelWebhookEventsDto) {
    return this.webhooks.list(user.organizationId, query);
  }

  @Post('process-pending')
  @RequirePermissions('channels.manage')
  processPending(@CurrentUser() user: AuthenticatedUser) {
    return this.webhooks.processPending(user.organizationId, 50);
  }

  @Post(':id/retry')
  @RequirePermissions('channels.manage')
  retry(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.webhooks.retry(user.organizationId, id);
  }
}
