import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { MessageDeliveryService } from './message-delivery.service';
import { AssignConversationDto } from './dto/assign-conversation.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { CloseSaleDto } from './dto/close-sale.dto';

export type InboundChannelMessage = {
  externalConversationId: string;
  externalMessageId: string;
  externalBuyerId: string;
  customerName?: string;
  content: string;
  sentAt: string;
};

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: MessageDeliveryService,
  ) {}

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
    const message = await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          conversationId,
          direction: 'OUTBOUND',
          type: 'TEXT',
          content: input.content.trim(),
          senderRole: 'CUSTOMER_SERVICE',
          sentAt: new Date(),
          deliveryStatus: 'QUEUED',
          nextDeliveryAttemptAt: new Date(),
        },
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { status: 'REPLIED', assignedUserId: user.id, lastMessageAt: message.sentAt } });
      return message;
    });
    return this.delivery.processMessage(message.id);
  }

  async ingestInbound(organizationId: string, channelAccountId: string, input: InboundChannelMessage) {
    const channel = await this.prisma.salesChannelAccount.findFirst({
      where: { id: channelAccountId, organizationId, active: true },
      select: { id: true },
    });
    if (!channel) throw new NotFoundException('Seller nhận tin nhắn không hợp lệ hoặc đã tạm dừng');
    const sentAt = new Date(input.sentAt);
    if (Number.isNaN(sentAt.getTime())) throw new BadRequestException('Thời gian tin nhắn không hợp lệ');

    return this.prisma.$transaction(async (tx) => {
      let identity = await tx.customerIdentity.findUnique({
        where: { channelAccountId_externalBuyerId: { channelAccountId, externalBuyerId: input.externalBuyerId } },
      });
      if (!identity) {
        const customer = await tx.customer.create({
          data: { organizationId, displayName: input.customerName?.trim() || `Khách ${input.externalBuyerId.slice(-8)}` },
        });
        identity = await tx.customerIdentity.create({
          data: {
            customerId: customer.id,
            channelAccountId,
            externalBuyerId: input.externalBuyerId,
            displayName: input.customerName?.trim() || null,
          },
        });
      }

      const conversation = await tx.conversation.upsert({
        where: { channelAccountId_externalId: { channelAccountId, externalId: input.externalConversationId } },
        create: {
          channelAccountId,
          customerIdentityId: identity.id,
          externalId: input.externalConversationId,
          status: 'OPEN',
          lastMessageAt: sentAt,
        },
        update: { status: 'OPEN', lastMessageAt: sentAt },
      });
      const existing = await tx.message.findUnique({
        where: { conversationId_externalId: { conversationId: conversation.id, externalId: input.externalMessageId } },
      });
      if (existing) return { conversation, message: existing, duplicated: true };
      const message = await tx.message.create({
        data: {
          conversationId: conversation.id,
          externalId: input.externalMessageId,
          direction: 'INBOUND',
          type: 'TEXT',
          content: input.content.trim(),
          senderRole: 'CUSTOMER',
          sentAt,
          deliveryStatus: 'RECEIVED',
          deliveredAt: sentAt,
        },
      });
      return { conversation, message, duplicated: false };
    });
  }

  async assign(user: AuthenticatedUser, conversationId: string, input: AssignConversationDto) {
    await this.assertAccessible(user, conversationId);
    const target = await this.prisma.user.findFirst({ where: { id: input.userId, organizationId: user.organizationId, active: true } });
    if (!target) throw new NotFoundException('Không tìm thấy nhân viên được phân công');
    return this.prisma.conversation.update({ where: { id: conversationId }, data: { assignedUserId: target.id } });
  }

  async closeSale(user: AuthenticatedUser, conversationId: string, input: CloseSaleDto) {
    await this.assertAccessible(user, conversationId);
    const conversation = await this.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    const order = await this.prisma.salesOrder.findFirst({ where: { id: input.orderId, channelAccount: { organizationId: user.organizationId }, status: { not: 'CANCELLED' } } });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng hợp lệ để ghi nhận doanh thu');
    if (order.channelAccountId !== conversation.channelAccountId) throw new BadRequestException('Đơn hàng phải thuộc cùng seller với hội thoại');
    return this.prisma.conversation.update({ where: { id: conversationId }, data: { status: 'CLOSED_WON', closedOrderId: order.id, closedByUserId: user.id, closedAt: new Date(), assignedUserId: user.id } });
  }

  processOutbox(organizationId: string) {
    return this.delivery.processPending(organizationId, 50);
  }

  retryMessage(organizationId: string, messageId: string) {
    return this.delivery.retry(organizationId, messageId);
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
