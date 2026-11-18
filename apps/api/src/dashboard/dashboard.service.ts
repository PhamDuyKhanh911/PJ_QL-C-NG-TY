import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(organizationId: string) {
    const now = new Date();
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const [orders, balances, conversations, channels, pendingSyncs, staleSyncs] = await Promise.all([
      this.prisma.salesOrder.findMany({ where: { channelAccount: { organizationId }, orderedAt: { gte: thirtyDaysAgo } }, include: { channelAccount: true } }),
      this.prisma.inventoryBalance.findMany({ where: { warehouse: { branch: { organizationId } } }, include: { warehouse: true, variant: { include: { product: true } } } }),
      this.prisma.conversation.findMany({ where: { channelAccount: { organizationId }, status: { in: ['UNREAD', 'UNREPLIED'] } }, include: { channelAccount: true, customerIdentity: true }, orderBy: { lastMessageAt: 'asc' } }),
      this.prisma.salesChannelAccount.findMany({ where: { organizationId, active: true }, orderBy: { name: 'asc' } }),
      this.prisma.channelSyncRun.count({ where: { channelAccount: { organizationId }, status: 'RUNNING' } }),
      this.prisma.channelSyncRun.count({ where: { channelAccount: { organizationId }, status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 15 * 60_000) } } }),
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

    const alerts = [
      ...(lowStock.length ? [{ type: 'LOW_STOCK', severity: 'CRITICAL', title: `${lowStock.length} SKU sắp hết hàng`, detail: 'Tồn có thể bán đã xuống dưới điểm đặt hàng lại' }] : []),
      ...(conversations.length ? [{ type: 'UNREPLIED', severity: 'WARNING', title: `${conversations.length} hội thoại cần phản hồi`, detail: 'Bao gồm tin chưa đọc và chưa trả lời' }] : []),
      ...(processingOrders ? [{ type: 'PROCESSING_ORDERS', severity: 'INFO', title: `${processingOrders} đơn đang xử lý`, detail: 'Đơn chờ xác nhận, đóng gói hoặc đang giao' }] : []),
      ...(pendingSyncs ? [{ type: 'PENDING_SYNCS', severity: staleSyncs ? 'CRITICAL' : 'INFO', title: `${pendingSyncs} tác vụ đồng bộ tồn đang chờ`, detail: staleSyncs ? `${staleSyncs} tác vụ đã chờ quá 15 phút, cần kiểm tra kết nối kênh` : 'Tác vụ được tạo tự động sau biến động tồn kho' }] : []),
    ];

    return {
      generatedAt: now,
      stats: { todayRevenue, processingOrders, unrepliedConversations: conversations.length, lowStockSkus: lowStock.length, pendingSyncs, staleSyncs },
      revenueByDay,
      channelPerformance,
      alerts,
      lowStock: lowStock.slice(0, 10),
    };
  }
}
