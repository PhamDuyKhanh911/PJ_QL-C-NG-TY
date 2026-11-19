import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { SalesModule } from '../sales/sales.module';
import { ChannelWebhookService } from './channel-webhook.service';
import { ChannelIntegrationEventsController, ChannelWebhooksController } from './channel-webhooks.controller';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelCredentialCipherService } from './channel-credential-cipher.service';

@Module({
  imports: [AuthModule, SalesModule, ConversationsModule],
  controllers: [ChannelsController, ChannelWebhooksController, ChannelIntegrationEventsController],
  providers: [ChannelsService, ChannelCredentialCipherService, ChannelWebhookService],
})
export class ChannelsModule {}
