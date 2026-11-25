import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { channelScopeWhere, DataScope, orderScopeWhere, warehouseScopeWhere } from '../auth/data-scope';
import { AlertsService } from '../alerts/alerts.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService, private readonly alertsService: AlertsService) {}

  async summary(organizationId: string, userId: string, scope: DataScope) {
    const now = new Date();
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const [orders, balances, conversations, channels, pendingSyncs, staleSyncs, inventoryMismatches, unmappedChannelSkus] = await Promise.all([
      this.prisma.salesOrder.findMany({ where: { AND: [orderScopeWhere(organizationId, scope)], orderedAt: { gte: thirtyDaysAgo } }, include: { channelAccount: true } }),
      this.prisma.inventoryBalance.findMany({ where: { warehouse: warehouseScopeWhere(organizationId, scope) }, include: { warehouse: true, variant: { include: { product: true } } } }),
      this.prisma.conversation.findMany({ where: { channelAccount: channelScopeWhere(organizationId, scope), status: { in: ['UNREAD', 'UNREPLIED'] } }, include: { channelAccount: true, customerIdentity: true }, orderBy: { lastMessageAt: 'asc' } }),
      this.prisma.salesChannelAccount.findMany({ where: { ...channelScopeWhere(organizationId, scope), active: true }, orderBy: { name: 'asc' } }),
      this.prisma.channelSyncRun.count({ where: { channelAccount: channelScopeWhere(organizationId, scope), status: 'RUNNING' } }),
      this.prisma.channelSyncRun.count({ where: { channelAccount: channelScopeWhere(organizationId, scope), status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 15 * 60_000) } } }),
      this.prisma.channelInventoryReconciliation.count({ where: { channelAccount: channelScopeWhere(organizationId, scope), status: 'MISMATCH' } }),
      this.prisma.channelInventoryReconciliation.count({ where: { channelAccount: channelScopeWhere(organizationId, scope), status: 'UNMAPPED' } }),
    ]);

    const activeStatuses: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PACKING, OrderStatus.SHIPPED];
    const validOrders = orders.filter((order) => order.status !== OrderStatus.CANCELLED);
    const todayRevenue = validOrders.filter((order) => order.orderedAt >= today).reduce((sum, order) => sum.add(order.total), new Prisma.Decimal(0));
    const processingOrders = orders.filter((order) => activeStatuses.includes(order.status)).length;
    const lowStock = balances.map((balance) => ({
      id: balance.id,
      sku: balance.variant.sku,
      product: balance.variant.product.name,
      warehouse: balance.warehouse.name,
      available: balance.onHand - balance.reserved - balance.quarantined - balance.safetyStock,
      reorderPoint: balance.reorderPoint,
    })).filter((item) => item.available <= item.reorderPoint).sort((a, b) => a.available - b.available);

    const revenueByDay = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(sevenDaysAgo); date.setDate(date.getDate() + index);
      const next = new Date(date); next.setDate(next.getDate() + 1);
      const revenue = validOrders.filter((order) => order.orderedAt >= date && order.orderedAt < next).reduce((sum, order) => sum.add(order.total), new Prisma.Decimal(0));
      return { date: date.toISOString().slice(0, 10), revenue };
    });

    const channelPerformance = channels.map((channel) => {
      const channelOrders = orders.filter((order) => order.channelAccountId === channel.id);
      const cancelled = channelOrders.filter((order) => order.status === OrderStatus.CANCELLED).length;
      const returnStatuses: OrderStatus[] = [OrderStatus.RETURNED, OrderStatus.PARTIALLY_RETURNED];
      const returned = channelOrders.filter((order) => returnStatuses.includes(order.status)).length;
      return {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        orders: channelOrders.length,
        revenue: channelOrders.filter((order) => order.status !== OrderStatus.CANCELLED).reduce((sum, order) => sum.add(order.total), new Prisma.Decimal(0)),
        issueRate: channelOrders.length ? (cancelled + returned) / channelOrders.length : 0,
        status: channelOrders.length && (cancelled + returned) / channelOrders.length > 0.1 ? 'WATCH' : 'STABLE',
      };
    });

    const alertResult = await this.alertsService.list(organizationId, { severity: 'ALL', type: 'ALL', status: 'ACTIVE' }, scope, userId);
    const workflowAlerts = alertResult.items.slice(0, 6).map((item) => ({
      id: item.id,
      type: item.type,
      severity: item.severity,
      title: item.title,
      detail: item.detail,
      href: item.href,
      status: item.status,
      assignedTo: item.assignedTo,
      isOverdue: item.isOverdue,
      isMine: item.isMine,
    }));

    return {
      generatedAt: now,
      stats: { todayRevenue, processingOrders, unrepliedConversations: conversations.length, lowStockSkus: lowStock.length, pendingSyncs, staleSyncs, inventoryMismatches, unmappedChannelSkus },
      revenueByDay,
      channelPerformance,
      alerts: workflowAlerts,
      work: alertResult.summary,
      lowStock: lowStock.slice(0, 10),
    };
  }
}
