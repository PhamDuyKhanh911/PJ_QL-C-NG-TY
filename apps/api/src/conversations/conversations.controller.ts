import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { ConversationsService } from './conversations.service';
import { AssignConversationDto } from './dto/assign-conversation.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { CloseSaleDto } from './dto/close-sale.dto';

@Controller('conversations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}
  @Get() @RequirePermissions('conversations.read') list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListConversationsDto) { return this.conversations.list(user, query); }
  @Get(':id') @RequirePermissions('conversations.read') detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.conversations.detail(user, id); }
  @Post('outbox/process-pending') @RequirePermissions('conversations.reply') processOutbox(@CurrentUser() user: AuthenticatedUser) { return this.conversations.processOutbox(user.organizationId); }
  @Post('outbox/:messageId/retry') @RequirePermissions('conversations.reply') retryMessage(@CurrentUser() user: AuthenticatedUser, @Param('messageId') messageId: string) { return this.conversations.retryMessage(user.organizationId, messageId); }
  @Post(':id/messages') @RequirePermissions('conversations.reply') reply(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: SendMessageDto) { return this.conversations.reply(user, id, input); }
  @Post(':id/assign') @RequirePermissions('conversations.reply') assign(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: AssignConversationDto) { return this.conversations.assign(user, id, input); }
  @Post(':id/close-sale') @RequirePermissions('conversations.close_sale') closeSale(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: CloseSaleDto) { return this.conversations.closeSale(user, id, input); }
}
