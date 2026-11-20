import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ListAlertsDto } from './dto/list-alerts.dto';
import { channelScopeWhere, DataScope, orderScopeWhere, warehouseScopeWhere } from '../auth/data-scope';

type Severity = 'CRITICAL' | 'WARNING' | 'INFO';
type AlertType = 'INVENTORY' | 'RECONCILIATION' | 'INTEGRATION' | 'CONNECTION' | 'RETURN';
type AlertItem = {
  id: string;
  type: AlertType;
  severity: Severity;
  title: string;
  detail: string;
  count: number;
  occurredAt: Date;
  ownerLabel: string;
  actionLabel: string;
  href: string;
};

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, query: ListAlertsDto, scope: DataScope) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const tokenWarningAt = new Date(now.getTime() + 3 * 24 * 60 * 60_000);

    const [balances, reconciliations, failedSyncs, channels, returns] = await Promise.all([
      this.prisma.inventoryBalance.findMany({
        where: { warehouse: warehouseScopeWhere(organizationId, scope) },
        include: { warehouse: true, variant: { include: { product: true } } },
      }),
      this.prisma.channelInventoryReconciliation.findMany({
        where: { channelAccount: channelScopeWhere(organizationId, scope), status: { in: ['MISMATCH', 'UNMAPPED'] } },
        include: { channelAccount: { select: { id: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.channelSyncRun.findMany({
        where: { channelAccount: channelScopeWhere(organizationId, scope), status: 'FAILED', startedAt: { gte: sevenDaysAgo } },
        include: { channelAccount: { select: { id: true, name: true } } },
        orderBy: { startedAt: 'desc' },
        take: 200,
      }),
      this.prisma.salesChannelAccount.findMany({
        where: { AND: [channelScopeWhere(organizationId, scope)], active: true, type: { in: ['TIKTOK_SHOP', 'SHOPEE', 'FACEBOOK_MESSENGER'] } },
        include: { connection: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.afterSaleRequest.findMany({
        where: { order: orderScopeWhere(organizationId, scope), status: { in: ['AWAITING_RETURN', 'LOST_IN_TRANSIT'] } },
        include: { order: { select: { orderNumber: true, channelAccount: { select: { name: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const alerts: AlertItem[] = [];

    for (const balance of balances) {
      const available = balance.onHand - balance.reserved - balance.quarantined - balance.safetyStock;
      if (available > balance.reorderPoint) continue;
      alerts.push({
        id: `inventory:${balance.id}`,
        type: 'INVENTORY',
        severity: available <= 0 ? 'CRITICAL' : 'WARNING',
        title: `${balance.variant.sku} ${available <= 0 ? 'đã hết tồn có thể bán' : 'sắp hết hàng'}`,
        detail: `${balance.variant.product.name} · ${balance.warehouse.name} · có thể bán ${available}, điểm nhập lại ${balance.reorderPoint}`,
        count: 1,
        occurredAt: now,
        ownerLabel: 'Thủ kho / mua hàng',
        actionLabel: 'Kiểm tra tồn kho',
        href: `/inventory?search=${encodeURIComponent(balance.variant.sku)}`,
      });
    }

    const reconciliationGroups = new Map<string, typeof reconciliations>();
    for (const item of reconciliations) {
      const key = `${item.channelAccountId}:${item.status}`;
      reconciliationGroups.set(key, [...(reconciliationGroups.get(key) ?? []), item]);
    }
    for (const group of reconciliationGroups.values()) {
      const first = group[0];
      const unmapped = first.status === 'UNMAPPED';
      alerts.push({
        id: `reconciliation:${first.channelAccountId}:${first.status}`,
        type: 'RECONCILIATION',
        severity: unmapped ? 'WARNING' : 'CRITICAL',
        title: `${first.channelAccount.name}: ${group.length} SKU ${unmapped ? 'chưa ánh xạ' : 'lệch tồn'}`,
        detail: unmapped ? 'Cần ghép SKU sàn với SKU nội bộ trước khi đồng bộ.' : 'Tồn seller khác tồn có thể bán trong hệ thống.',
        count: group.length,
        occurredAt: first.updatedAt,
        ownerLabel: 'Quản lý bán online',
        actionLabel: unmapped ? 'Ánh xạ SKU' : 'Đối chiếu tồn',
        href: `/inventory/channel-reconciliation?status=${first.status}`,
      });
    }

    const latestFailedSync = new Map<string, (typeof failedSyncs)[number]>();
    for (const run of failedSyncs) {
      const key = `${run.channelAccountId}:${this.syncGroup(run.direction)}`;
      if (!latestFailedSync.has(key)) latestFailedSync.set(key, run);
    }
    for (const run of latestFailedSync.values()) {
      alerts.push({
        id: `integration:${run.channelAccountId}:${run.direction}`,
        type: 'INTEGRATION',
        severity: run.direction === 'PUSH_INVENTORY' ? 'CRITICAL' : 'WARNING',
        title: `${run.channelAccount.name}: đồng bộ ${this.directionLabel(run.direction)} thất bại`,
        detail: run.errorMessage ?? `${run.failedCount} bản ghi lỗi trong lần chạy gần nhất.`,
        count: Math.max(run.failedCount, 1),
        occurredAt: run.completedAt ?? run.startedAt,
        ownerLabel: 'Quản lý tích hợp',
        actionLabel: 'Xem lỗi đồng bộ',
        href: '/integrations',
      });
    }

    for (const channel of channels) {
      const connection = channel.connection;
      const tokenExpiring = connection?.accessTokenExpiresAt && connection.accessTokenExpiresAt <= tokenWarningAt;
      const tokenFailed = connection && ['FAILED', 'REAUTH_REQUIRED'].includes(connection.tokenRefreshStatus);
      if (connection?.status === 'READY' && !tokenExpiring && !tokenFailed) continue;
      const reason = !connection
        ? 'Chưa cấu hình kết nối API.'
        : tokenFailed
          ? 'Làm mới token thất bại, cần cấp quyền lại.'
          : tokenExpiring
            ? `Token hết hạn ${connection.accessTokenExpiresAt!.toLocaleDateString('vi-VN')}.`
            : connection.lastError ?? 'Kết nối chưa sẵn sàng.';
      alerts.push({
        id: `connection:${channel.id}`,
        type: 'CONNECTION',
        severity: tokenFailed || connection?.status === 'ERROR' || Boolean(connection?.accessTokenExpiresAt && connection.accessTokenExpiresAt <= now) ? 'CRITICAL' : 'WARNING',
        title: `${channel.name}: kết nối cần xử lý`,
        detail: reason,
        count: 1,
        occurredAt: connection?.updatedAt ?? now,
        ownerLabel: 'Quản trị kênh bán',
        actionLabel: 'Mở cấu hình seller',
        href: '/channels',
      });
    }

    for (const item of returns) {
      const lost = item.status === 'LOST_IN_TRANSIT';
      const waitingDays = Math.max(0, Math.floor((now.getTime() - item.createdAt.getTime()) / (24 * 60 * 60_000)));
      alerts.push({
        id: `return:${item.id}`,
        type: 'RETURN',
        severity: lost || waitingDays >= 7 ? 'CRITICAL' : 'WARNING',
        title: `${item.order.orderNumber}: ${lost ? 'hàng hoàn thất lạc' : 'chưa trả về kho'}`,
        detail: `${item.order.channelAccount.name} · số lượng ${item.quantity} · đã chờ ${waitingDays} ngày${lost ? ' · trách nhiệm đơn vị vận chuyển' : ''}`,
        count: item.quantity,
        occurredAt: item.createdAt,
        ownerLabel: 'Thủ kho / vận chuyển',
        actionLabel: 'Theo dõi hàng hoàn',
        href: '/after-sales',
      });
    }

    const rank: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || b.occurredAt.getTime() - a.occurredAt.getTime());
    const search = query.search?.trim().toLocaleLowerCase('vi-VN');
    const items = alerts.filter((item) =>
      (query.severity === 'ALL' || item.severity === query.severity)
      && (query.type === 'ALL' || item.type === query.type)
      && (!search || `${item.title} ${item.detail} ${item.ownerLabel}`.toLocaleLowerCase('vi-VN').includes(search)),
    );

    return {
      generatedAt: now,
      summary: {
        total: alerts.length,
        critical: alerts.filter((item) => item.severity === 'CRITICAL').length,
        warning: alerts.filter((item) => item.severity === 'WARNING').length,
        inventory: alerts.filter((item) => item.type === 'INVENTORY').length,
        seller: alerts.filter((item) => ['RECONCILIATION', 'INTEGRATION', 'CONNECTION'].includes(item.type)).length,
        returns: alerts.filter((item) => item.type === 'RETURN').length,
      },
      appliedFilters: { severity: query.severity, type: query.type, search: query.search ?? '' },
      items,
    };
  }

  private directionLabel(direction: string) {
    const labels: Record<string, string> = { PUSH_INVENTORY: 'tồn lên sàn', PULL_ORDERS: 'đơn từ sàn', PULL_INVENTORY: 'tồn từ sàn', PULL_CHAT: 'tin nhắn' };
    return labels[direction] ?? (this.syncGroup(direction) === 'ORDERS' ? 'đơn từ sàn' : this.syncGroup(direction) === 'CHAT' ? 'tin nhắn' : 'tồn lên sàn');
  }

  private syncGroup(direction: string) {
    const normalized = direction.toUpperCase();
    if (normalized.includes('ORDER')) return 'ORDERS';
    if (normalized.includes('CHAT') || normalized.includes('MESSAGE')) return 'CHAT';
    return 'INVENTORY';
  }
}
