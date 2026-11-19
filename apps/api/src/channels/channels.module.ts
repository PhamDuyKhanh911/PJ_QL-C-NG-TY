import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelCredentialCipherService } from './channel-credential-cipher.service';
@Module({ imports: [AuthModule], controllers: [ChannelsController], providers: [ChannelsService, ChannelCredentialCipherService] })
export class ChannelsModule {}
