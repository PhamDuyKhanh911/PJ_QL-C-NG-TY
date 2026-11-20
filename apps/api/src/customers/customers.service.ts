import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListCustomersDto } from './dto/list-customers.dto';
import { channelScopeWhere, DataScope, orderScopeWhere } from '../auth/data-scope';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, query: ListCustomersDto, scope: DataScope) {
    const orderScope = orderScopeWhere(organizationId, scope);
    const channelScope = channelScopeWhere(organizationId, scope);
    const access: Prisma.CustomerWhereInput = scope.organization ? { organizationId } : { organizationId, OR: [{ orders: { some: orderScope } }, { identities: { some: { conversations: { some: { channelAccount: channelScope } } } } }] };
    const where: Prisma.CustomerWhereInput = {
      AND: [access],
      ...(query.search ? { OR: [
        { displayName: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { identities: { some: { displayName: { contains: query.search, mode: 'insensitive' } } } },
      ] } : {}),
    };
    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: {
          orders: { where: orderScope, select: { total: true, status: true, orderedAt: true, afterSales: { select: { id: true } } }, orderBy: { orderedAt: 'desc' } },
          identities: { where: { conversations: { some: { channelAccount: channelScope } } }, include: { conversations: { where: { channelAccount: channelScope }, include: { channelAccount: { select: { id: true, name: true, type: true } } }, orderBy: { lastMessageAt: 'desc' }, take: 1 } } },
        },
        orderBy: { displayName: 'asc' }, skip: (query.page - 1) * query.limit, take: query.limit,
      }),
      this.prisma.customer.count({ where }),
    ]);
    const data = customers.map((customer) => {
      const validOrders = customer.orders.filter((order) => order.status !== OrderStatus.CANCELLED);
      const spent = validOrders.reduce((sum, order) => sum.add(order.total), new Prisma.Decimal(0));
      const channels = new Map<string, { id: string; name: string; type: string }>();
      customer.identities.forEach((identity) => identity.conversations.forEach((conversation) => channels.set(conversation.channelAccount.id, conversation.channelAccount)));
      return {
        id: customer.id, displayName: customer.displayName, phone: customer.phone, email: customer.email,
        orderCount: customer.orders.length, totalSpent: spent, afterSaleCount: customer.orders.reduce((sum, order) => sum + order.afterSales.length, 0),
        lastOrderAt: customer.orders[0]?.orderedAt ?? null, channels: [...channels.values()], identityCount: customer.identities.length,
      };
    });
    return { data, meta: { total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) } };
  }

  async detail(organizationId: string, id: string, scope: DataScope) {
    const orderScope = orderScopeWhere(organizationId, scope);
    const channelScope = channelScopeWhere(organizationId, scope);
    const access: Prisma.CustomerWhereInput = scope.organization ? { organizationId } : { organizationId, OR: [{ orders: { some: orderScope } }, { identities: { some: { conversations: { some: { channelAccount: channelScope } } } } }] };
    const customer = await this.prisma.customer.findFirst({
      where: { id, AND: [access] },
      include: {
        orders: { where: orderScope, include: { channelAccount: true, afterSales: true, items: { include: { variant: { include: { product: true } } } } }, orderBy: { orderedAt: 'desc' }, take: 20 },
        identities: { where: { conversations: { some: { channelAccount: channelScope } } }, include: { conversations: { where: { channelAccount: channelScope }, include: { channelAccount: true, messages: { orderBy: { sentAt: 'desc' }, take: 1 } }, orderBy: { lastMessageAt: 'desc' } } } },
      },
    });
    if (!customer) throw new NotFoundException('Không tìm thấy khách hàng');
    return customer;
  }
}
