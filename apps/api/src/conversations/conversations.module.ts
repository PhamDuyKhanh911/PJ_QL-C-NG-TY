import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChannelCredentialCipherService } from '../channels/channel-credential-cipher.service';
import { ConversationsController } from './conversations.controller';
import { MessageDeliveryService } from './message-delivery.service';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [AuthModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, MessageDeliveryService, ChannelCredentialCipherService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
