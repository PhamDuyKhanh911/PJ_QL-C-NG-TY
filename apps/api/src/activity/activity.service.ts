import { Injectable } from '@nestjs/common';
import { channelScopeWhere, type DataScope, orderScopeWhere, warehouseScopeWhere } from '../auth/data-scope';
import { PrismaService } from '../prisma/prisma.service';
import { ListActivityDto } from './dto/list-activity.dto';

type ActivityItem = {
  id: string;
  category: string;
  action: string;
  title: string;
  detail: string;
  occurredAt: Date;
  actorId: string | null;
  responsibleUserId: string | null;
  reference: string | null;
  risk: 'HIGH' | 'MEDIUM' | 'NORMAL';
};

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  actors(organizationId: string, currentUserId: string, scope: DataScope) {
    return this.prisma.user.findMany({ where: { organizationId, ...(!scope.organization ? { id: currentUserId } : {}) }, select: { id: true, displayName: true, email: true, active: true }, orderBy: { displayName: 'asc' } });
  }

  async list(organizationId: string, query: ListActivityDto, scope: DataScope) {
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const to = query.to ? new Date(query.to) : new Date();
    const date = { gte: from, lte: to };
    const includeCategory = (category: string) => query.category === 'ALL' || query.category === category;
    const take = query.limit;

    const [audits, inventory, fulfillment, syncRuns, purchases] = await Promise.all([
      scope.organization ? this.prisma.auditEvent.findMany({ where: { organizationId, createdAt: date, ...(query.userId ? { actorId: query.userId } : {}), ...(query.category === 'ALL' ? {} : { category: query.category }) }, orderBy: { createdAt: 'desc' }, take }) : [],
      includeCategory('INVENTORY') ? this.prisma.inventoryTransaction.findMany({ where: { warehouse: warehouseScopeWhere(organizationId, scope), createdAt: date, ...(query.userId ? { performedById: query.userId } : {}) }, include: { warehouse: true }, orderBy: { createdAt: 'desc' }, take }) : [],
      includeCategory('FULFILLMENT') ? this.prisma.orderFulfillmentEvent.findMany({ where: { order: orderScopeWhere(organizationId, scope), createdAt: date, ...(query.userId ? { performedById: query.userId } : {}) }, include: { order: { select: { orderNumber: true, channelAccount: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' }, take }) : [],
      includeCategory('CHANNEL') ? this.prisma.channelSyncRun.findMany({ where: { channelAccount: channelScopeWhere(organizationId, scope), startedAt: date, ...(query.userId ? { triggeredById: query.userId } : {}) }, include: { channelAccount: { select: { name: true, code: true } } }, orderBy: { startedAt: 'desc' }, take }) : [],
      includeCategory('PURCHASING') ? this.prisma.purchaseOrder.findMany({ where: { organizationId, warehouse: warehouseScopeWhere(organizationId, scope), createdAt: date, ...(query.userId ? { createdById: query.userId } : {}) }, include: { supplier: { select: { name: true } }, warehouse: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take }) : [],
    ]);

    const variantIds = [...new Set(inventory.map((item) => item.variantId))];
    const variants = await this.prisma.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, sku: true, name: true, product: { select: { name: true } } } });
    const variantMap = new Map(variants.map((item) => [item.id, item]));

    const items: ActivityItem[] = [
      ...audits.map((item) => ({ id: `audit:${item.id}`, category: item.category, action: item.action, title: item.summary, detail: this.auditDetail(item.metadata), occurredAt: item.createdAt, actorId: item.actorId, responsibleUserId: null, reference: item.entityId, risk: this.auditRisk(item.category, item.action) } as ActivityItem)),
      ...inventory.map((item) => { const variant = variantMap.get(item.variantId); return { id: `inventory:${item.id}`, category: 'INVENTORY', action: item.type, title: this.inventoryTitle(item.type, item.quantity), detail: `${variant?.sku ?? item.variantId} · ${variant?.product.name ?? variant?.name ?? 'Sản phẩm'} · ${item.warehouse.name}${item.reason ? ` · ${item.reason}` : ''}`, occurredAt: item.createdAt, actorId: item.performedById, responsibleUserId: null, reference: item.referenceId, risk: ['ADJUSTMENT', 'SALE', 'RETURN_OUT'].includes(item.type) ? 'HIGH' : 'MEDIUM' } as ActivityItem; }),
      ...fulfillment.map((item) => ({ id: `fulfillment:${item.id}`, category: 'FULFILLMENT', action: item.action, title: item.action === 'WAREHOUSE_BATCH_DISPATCHED' ? 'Xuất kho theo lô' : 'Thủ kho xác nhận xuất hàng', detail: `${item.order.orderNumber} · ${item.order.channelAccount.name}${item.carrierName ? ` · ${item.carrierName}` : ''}${item.note ? ` · ${item.note}` : ''}`, occurredAt: item.createdAt, actorId: item.performedById, responsibleUserId: item.responsibleUserId, reference: item.batchCode ?? item.orderId, risk: 'HIGH' } as ActivityItem)),
      ...syncRuns.map((item) => ({ id: `sync:${item.id}`, category: 'CHANNEL', action: item.direction, title: this.syncTitle(item.direction), detail: `${item.channelAccount.name} · ${item.status} · thành công ${item.processedCount}, lỗi ${item.failedCount}`, occurredAt: item.startedAt, actorId: item.triggeredById, responsibleUserId: null, reference: item.channelAccount.code, risk: item.failedCount > 0 ? 'MEDIUM' : 'NORMAL' } as ActivityItem)),
      ...purchases.map((item) => ({ id: `purchase:${item.id}`, category: 'PURCHASING', action: 'PURCHASE_ORDER_CREATED', title: 'Tạo đơn nhập hàng', detail: `${item.orderNumber} · ${item.supplier.name} · nhận tại ${item.warehouse.name}`, occurredAt: item.createdAt, actorId: item.createdById, responsibleUserId: null, reference: item.orderNumber, risk: 'MEDIUM' } as ActivityItem)),
    ];

    const keyword = query.search?.trim().toLocaleLowerCase('vi-VN');
    const filtered = items.filter((item) => !keyword || `${item.title} ${item.detail} ${item.reference ?? ''}`.toLocaleLowerCase('vi-VN').includes(keyword)).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, query.limit);
    const userIds = [...new Set(filtered.flatMap((item) => [item.actorId, item.responsibleUserId].filter((value): value is string => Boolean(value))))];
    const users = await this.prisma.user.findMany({ where: { organizationId, id: { in: userIds } }, select: { id: true, displayName: true, email: true } });
    const userMap = new Map(users.map((user) => [user.id, user]));
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    return {
      items: filtered.map((item) => ({ ...item, actor: item.actorId ? userMap.get(item.actorId) ?? null : null, responsibleUser: item.responsibleUserId ? userMap.get(item.responsibleUserId) ?? null : null })),
      summary: { total: filtered.length, today: filtered.filter((item) => item.occurredAt >= startToday).length, highRisk: filtered.filter((item) => item.risk === 'HIGH').length, actors: new Set(filtered.map((item) => item.actorId).filter(Boolean)).size },
      range: { from, to },
    };
  }

  private inventoryTitle(type: string, quantity: number) {
    const labels: Record<string, string> = { ADJUSTMENT: 'Điều chỉnh tồn kho', SALE: 'Xuất kho bán hàng', RECEIPT: 'Nhập hàng vào kho', RETURN_IN: 'Nhận hàng hoàn', RETURN_OUT: 'Loại hàng hoàn khỏi kho', QUARANTINE: 'Kiểm định hàng hoàn', RESERVATION: 'Giữ tồn cho đơn', RESERVATION_RELEASE: 'Hoàn lại tồn giữ chỗ' };
    return `${labels[type] ?? type} · ${quantity > 0 ? '+' : ''}${quantity}`;
  }

  private syncTitle(direction: string) {
    const labels: Record<string, string> = { PUSH_INVENTORY: 'Đồng bộ tồn kho lên seller', PULL_ORDERS: 'Đồng bộ đơn từ seller', RECONCILE_INVENTORY: 'Đồng bộ lại tồn chênh lệch' };
    return labels[direction] ?? direction;
  }

  private auditDetail(metadata: unknown) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '';
    return Object.entries(metadata as Record<string, unknown>).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).slice(0, 6).map(([key, value]) => `${key}: ${String(value)}`).join(' · ');
  }

  private auditRisk(category: string, action: string): ActivityItem['risk'] {
    if (category === 'ADMINISTRATION' || category === 'BACKUP' || action.includes('CONNECTION')) return 'HIGH';
    return 'MEDIUM';
  }
}
