import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { AssignConversationDto } from './dto/assign-conversation.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser, query: ListConversationsDto) {
    const channelIds = await this.allowedChannelIds(user);
    if (query.channelAccountId && !channelIds.includes(query.channelAccountId)) return [];
    const where: Prisma.ConversationWhereInput = {
      channelAccountId: query.channelAccountId ?? { in: channelIds },
      ...(query.status !== 'ALL' ? { status: query.status } : {}),
      ...(query.search ? { OR: [
        { customerIdentity: { displayName: { contains: query.search, mode: 'insensitive' } } },
        { messages: { some: { content: { contains: query.search, mode: 'insensitive' } } } },
      ] } : {}),
    };
    return this.prisma.conversation.findMany({
      where,
      include: {
        channelAccount: { select: { id: true, name: true, type: true, code: true } },
        customerIdentity: { include: { customer: { select: { id: true, displayName: true, phone: true, email: true } } } },
        messages: { orderBy: { sentAt: 'desc' }, take: 1 },
        _count: { select: { messages: true } },
      },
      orderBy: [{ lastMessageAt: 'desc' }],
    });
  }

  async detail(user: AuthenticatedUser, conversationId: string) {
    await this.assertAccessible(user, conversationId);
    return this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        channelAccount: true,
        customerIdentity: { include: { customer: { include: { orders: { include: { channelAccount: true }, orderBy: { orderedAt: 'desc' }, take: 5 } } } } },
        messages: { orderBy: { sentAt: 'asc' } },
      },
    });
  }

  async reply(user: AuthenticatedUser, conversationId: string, input: SendMessageDto) {
    await this.assertAccessible(user, conversationId);
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: { conversationId, direction: 'OUTBOUND', type: 'TEXT', content: input.content.trim(), senderRole: 'CUSTOMER_SERVICE', sentAt: new Date() },
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { status: 'REPLIED', assignedUserId: user.id, lastMessageAt: message.sentAt } });
      return { ...message, deliveryStatus: 'QUEUED' };
    });
  }

  async assign(user: AuthenticatedUser, conversationId: string, input: AssignConversationDto) {
    await this.assertAccessible(user, conversationId);
    const target = await this.prisma.user.findFirst({ where: { id: input.userId, organizationId: user.organizationId, active: true } });
    if (!target) throw new NotFoundException('Không tìm thấy nhân viên được phân công');
    return this.prisma.conversation.update({ where: { id: conversationId }, data: { assignedUserId: target.id } });
  }

  private async assertAccessible(user: AuthenticatedUser, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { channelAccountId: true } });
    if (!conversation) throw new NotFoundException('Không tìm thấy hội thoại');
    const allowed = await this.allowedChannelIds(user);
    if (!allowed.includes(conversation.channelAccountId)) throw new ForbiddenException('Bạn không có quyền truy cập gian hàng này');
  }

  private async allowedChannelIds(user: AuthenticatedUser) {
    const hasOrganizationScope = user.scopes.some((scope) => scope.type === 'ORGANIZATION' && scope.id === user.organizationId);
    if (hasOrganizationScope) {
      const channels = await this.prisma.salesChannelAccount.findMany({ where: { organizationId: user.organizationId, active: true }, select: { id: true } });
      return channels.map((channel) => channel.id);
    }
    return user.scopes.filter((scope) => scope.type === 'CHANNEL' && scope.id).map((scope) => scope.id!);
  }
}
