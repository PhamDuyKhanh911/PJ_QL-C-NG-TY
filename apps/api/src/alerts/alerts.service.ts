import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ListAlertsDto } from './dto/list-alerts.dto';
import { channelScopeWhere, DataScope, orderScopeWhere, warehouseScopeWhere } from '../auth/data-scope';
import { UpdateAlertStatusDto } from './dto/update-alert-status.dto';

type Severity = 'CRITICAL' | 'WARNING' | 'INFO';
type AlertType = 'INVENTORY' | 'RECONCILIATION' | 'INTEGRATION' | 'CONNECTION' | 'RETURN';
type WorkflowStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
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
  sourceFingerprint: string;
};

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, query: ListAlertsDto, scope: DataScope, currentUserId?: string) {
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
        sourceFingerprint: [balance.onHand, balance.reserved, balance.quarantined, balance.safetyStock, balance.reorderPoint].join(':'),
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
        sourceFingerprint: group.map((item) => `${item.id}:${item.updatedAt.toISOString()}:${item.difference}`).sort().join('|'),
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
        sourceFingerprint: run.id,
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
        sourceFingerprint: connection ? `${connection.updatedAt.toISOString()}:${connection.status}:${connection.tokenRefreshStatus}` : 'CONNECTION_MISSING',
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
        sourceFingerprint: `${item.status}:${item.createdAt.toISOString()}:${item.quantity}`,
      });
    }

    const rank: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || b.occurredAt.getTime() - a.occurredAt.getTime());
    const workflows = await this.prisma.alertWorkflow.findMany({ where: { organizationId, alertKey: { in: alerts.map((item) => item.id) } } });
    const workflowByKey = new Map(workflows.map((workflow) => [workflow.alertKey, workflow]));
    const assignedUserIds = [...new Set(workflows.map((workflow) => workflow.assignedUserId).filter((id): id is string => Boolean(id)))];
    const assignedUsers = await this.prisma.user.findMany({ where: { organizationId, id: { in: assignedUserIds } }, select: { id: true, displayName: true, email: true } });
    const userById = new Map(assignedUsers.map((user) => [user.id, user]));
    const enriched = alerts.map((item) => {
      const saved = workflowByKey.get(item.id);
      const current = saved?.sourceFingerprint === item.sourceFingerprint ? saved : null;
      const status = (current?.status ?? 'OPEN') as WorkflowStatus;
      const slaHours = item.severity === 'CRITICAL' ? 4 : item.severity === 'WARNING' ? 24 : 48;
      const isOverdue = status === 'IN_PROGRESS' && Boolean(current && current.updatedAt.getTime() < now.getTime() - slaHours * 60 * 60_000);
      return {
        ...item,
        severity: isOverdue ? 'CRITICAL' as const : item.severity,
        status,
        assignedTo: current?.assignedUserId ? userById.get(current.assignedUserId) ?? null : null,
        resolutionNote: current?.resolutionNote ?? null,
        workflowUpdatedAt: current?.updatedAt ?? null,
        isOverdue,
        slaHours,
        isMine: Boolean(currentUserId && current?.assignedUserId === currentUserId),
      };
    });
    enriched.sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue) || rank[a.severity] - rank[b.severity] || b.occurredAt.getTime() - a.occurredAt.getTime());
    const search = query.search?.trim().toLocaleLowerCase('vi-VN');
    const requestedStatus = query.status ?? 'ACTIVE';
    const items = enriched.filter((item) =>
      (query.severity === 'ALL' || item.severity === query.severity)
      && (query.type === 'ALL' || item.type === query.type)
      && (requestedStatus === 'ALL' || (requestedStatus === 'ACTIVE' ? item.status !== 'RESOLVED' : item.status === requestedStatus))
      && (!search || `${item.title} ${item.detail} ${item.ownerLabel}`.toLocaleLowerCase('vi-VN').includes(search)),
    );

    return {
      generatedAt: now,
      summary: {
        total: enriched.length,
        critical: enriched.filter((item) => item.severity === 'CRITICAL' && item.status !== 'RESOLVED').length,
        warning: enriched.filter((item) => item.severity === 'WARNING' && item.status !== 'RESOLVED').length,
        inventory: enriched.filter((item) => item.type === 'INVENTORY' && item.status !== 'RESOLVED').length,
        seller: enriched.filter((item) => ['RECONCILIATION', 'INTEGRATION', 'CONNECTION'].includes(item.type) && item.status !== 'RESOLVED').length,
        returns: enriched.filter((item) => item.type === 'RETURN' && item.status !== 'RESOLVED').length,
        open: enriched.filter((item) => item.status === 'OPEN').length,
        inProgress: enriched.filter((item) => item.status === 'IN_PROGRESS').length,
        resolved: enriched.filter((item) => item.status === 'RESOLVED').length,
        overdue: enriched.filter((item) => item.isOverdue).length,
        mine: enriched.filter((item) => item.isMine && item.status !== 'RESOLVED').length,
      },
      appliedFilters: { severity: query.severity, type: query.type, status: requestedStatus, search: query.search ?? '' },
      items,
    };
  }

  async updateStatus(organizationId: string, userId: string, alertId: string, input: UpdateAlertStatusDto, scope: DataScope) {
    const snapshot = await this.list(organizationId, { severity: 'ALL', type: 'ALL', status: 'ALL' }, scope, userId);
    const alert = snapshot.items.find((item) => item.id === alertId);
    if (!alert) throw new NotFoundException('Cảnh báo không còn tồn tại hoặc nằm ngoài phạm vi được giao');
    const note = input.note?.trim() || null;
    const previous = await this.prisma.alertWorkflow.findUnique({ where: { organizationId_alertKey: { organizationId, alertKey: alertId } } });
    const assignedUserId = input.status === 'OPEN' ? null : input.status === 'IN_PROGRESS' ? userId : previous?.assignedUserId ?? userId;
    const resolved = input.status === 'RESOLVED';
    const workflow = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.alertWorkflow.upsert({
        where: { organizationId_alertKey: { organizationId, alertKey: alertId } },
        create: {
          organizationId,
          alertKey: alertId,
          sourceFingerprint: alert.sourceFingerprint,
          status: input.status,
          assignedUserId,
          resolutionNote: resolved ? note : null,
          resolvedById: resolved ? userId : null,
          resolvedAt: resolved ? new Date() : null,
        },
        update: {
          sourceFingerprint: alert.sourceFingerprint,
          status: input.status,
          assignedUserId,
          resolutionNote: resolved ? note : null,
          resolvedById: resolved ? userId : null,
          resolvedAt: resolved ? new Date() : null,
        },
      });
      await tx.auditEvent.create({ data: {
        organizationId,
        actorId: userId,
        category: 'ALERT',
        action: `ALERT_${input.status}`,
        entityType: 'ALERT',
        entityId: alertId,
        summary: `${input.status === 'IN_PROGRESS' ? 'Nhận xử lý' : input.status === 'RESOLVED' ? 'Hoàn tất' : 'Mở lại'} cảnh báo ${alert.title}`,
        metadata: { type: alert.type, severity: alert.severity, note: note ?? '' },
      } });
      return saved;
    });
    const assignedTo = workflow.assignedUserId
      ? await this.prisma.user.findFirst({ where: { id: workflow.assignedUserId, organizationId }, select: { id: true, displayName: true, email: true } })
      : null;
    return { alertId, status: workflow.status, assignedTo, resolutionNote: workflow.resolutionNote, updatedAt: workflow.updatedAt };
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
