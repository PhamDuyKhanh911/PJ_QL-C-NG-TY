import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { SalesModule } from '../sales/sales.module';
import { ChannelWebhookService } from './channel-webhook.service';
import { ChannelIntegrationEventsController, ChannelWebhooksController } from './channel-webhooks.controller';
import { ChannelsController } from './channels.controller';
import { ChannelOAuthController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelCredentialCipherService } from './channel-credential-cipher.service';
import { ChannelTokenService } from './channel-token.service';
import { ChannelOAuthService } from './channel-oauth.service';
import { ChannelOrderSyncService } from './channel-order-sync.service';

@Module({
  imports: [AuthModule, SalesModule, ConversationsModule],
  controllers: [ChannelsController, ChannelOAuthController, ChannelWebhooksController, ChannelIntegrationEventsController],
  providers: [ChannelsService, ChannelCredentialCipherService, ChannelTokenService, ChannelOAuthService, ChannelOrderSyncService, ChannelWebhookService],
})
export class ChannelsModule {}
