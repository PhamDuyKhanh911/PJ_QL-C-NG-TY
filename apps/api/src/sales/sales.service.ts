import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AfterSaleType, ChannelType, InventoryTransactionType, OrderStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersDto } from './dto/list-orders.dto';
import { queueInventorySync } from '../channels/queue-inventory-sync';
import { SyncMarketplaceOrderDto } from './dto/sync-marketplace-order.dto';

export type MarketplaceStatusInput = {
  externalOrderId: string;
  externalStatus: string;
  occurredAt?: string;
  reasonCode?: string;
};

export type MarketplaceReturnInput = {
  externalOrderId: string;
  sourceEventId: string;
  reasonCode?: string;
  occurredAt?: string;
  items?: Array<{ externalSkuId: string; quantity: number }>;
};

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, query: ListOrdersDto) {
    const where: Prisma.SalesOrderWhereInput = {
      channelAccount: { organizationId },
      ...(query.channelAccountId ? { channelAccountId: query.channelAccountId } : {}),
      ...(query.status ? { status: query.status as OrderStatus } : {}),
      ...(query.from || query.to ? { orderedAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.salesOrder.findMany({ where, include: { channelAccount: true, warehouse: true, customer: true, items: { include: { variant: { include: { product: true } } } }, afterSales: true, fulfillmentEvents: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { orderedAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return { data, total, page: query.page, limit: query.limit };
  }

  async create(organizationId: string, performedById: string, input: CreateOrderDto) {
    const [channel, warehouse, variants] = await Promise.all([
      this.prisma.salesChannelAccount.findFirst({ where: { id: input.channelAccountId, organizationId, active: true } }),
      this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, branch: { organizationId } } }),
      this.prisma.productVariant.findMany({ where: { id: { in: input.items.map((item) => item.variantId) }, product: { organizationId, active: true } } }),
    ]);
    if (!channel || !warehouse || variants.length !== new Set(input.items.map((item) => item.variantId)).size) throw new NotFoundException('Kênh bán, kho hoặc SKU không hợp lệ');
    if (channel.type === ChannelType.SHOPEE || channel.type === ChannelType.TIKTOK_SHOP) throw new BadRequestException('Đơn Shopee/TikTok phải đồng bộ tự động từ seller, không nhập tay');
    const responsibleUser = input.responsibleUserId ? await this.prisma.user.findFirst({ where: { id: input.responsibleUserId, organizationId, active: true } }) : null;
    if (channel.type === ChannelType.OFFLINE_STORE && !responsibleUser) throw new BadRequestException('Phiếu offline bắt buộc chọn nhân viên nhận hàng để đóng gói');
    const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
    const subtotal = input.items.reduce((sum, item) => sum.add(variantMap.get(item.variantId)!.salePrice.mul(item.quantity)), new Prisma.Decimal(0));
    const discount = new Prisma.Decimal(input.discount);
    if (discount.greaterThan(subtotal)) throw new BadRequestException('Giảm giá không được lớn hơn tiền hàng');

    const orderId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      for (const item of input.items) {
        const balance = await tx.inventoryBalance.findUnique({ where: { warehouseId_variantId: { warehouseId: warehouse.id, variantId: item.variantId } } });
        const available = balance ? balance.onHand - balance.reserved - balance.quarantined - balance.safetyStock : 0;
        if (!balance || available < item.quantity) throw new BadRequestException(`SKU ${variantMap.get(item.variantId)!.sku} không đủ tồn có thể bán`);
        const reserved = await tx.$executeRaw(Prisma.sql`
          UPDATE "InventoryBalance"
          SET "reserved" = "reserved" + ${item.quantity}
          WHERE "id" = ${balance.id}
            AND ("onHand" - "reserved" - "quarantined" - "safetyStock") >= ${item.quantity}
        `);
        if (reserved !== 1) throw new BadRequestException(`SKU ${variantMap.get(item.variantId)!.sku} vừa được đơn khác giữ hết; vui lòng tải lại tồn kho`);
        await tx.inventoryTransaction.create({ data: { warehouseId: warehouse.id, variantId: item.variantId, type: InventoryTransactionType.RESERVATION, quantity: item.quantity, reason: 'Giữ tồn cho đơn hàng mới', referenceType: 'SALES_ORDER', referenceId: orderId, performedById } });
      }
      const customer = input.customerName ? await tx.customer.create({ data: { organizationId, displayName: input.customerName } }) : null;
      const order = await tx.salesOrder.create({
        data: {
          id: orderId,
          orderNumber: `ORD-${Date.now().toString(36).toUpperCase()}`,
          channelAccountId: channel.id,
          warehouseId: warehouse.id,
          customerId: customer?.id,
          status: OrderStatus.CONFIRMED,
          subtotal,
          discount,
          total: subtotal.sub(discount),
          recipientName: input.recipientName ?? input.customerName,
          recipientPhone: input.recipientPhone,
          recipientAddress: input.recipientAddress,
          recipientNote: input.recipientNote,
          responsibleUserId: responsibleUser?.id,
          responsibilityAssignedAt: responsibleUser ? new Date() : undefined,
          orderedAt: new Date(),
          items: { create: input.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity, unitPrice: variantMap.get(item.variantId)!.salePrice })) },
        },
        include: { items: true, channelAccount: true, warehouse: true, customer: true },
      });
      await queueInventorySync(tx, input.items.map((item) => item.variantId), performedById, 'ORDER_RESERVED');
      return order;
    });
  }

  async syncMarketplace(organizationId: string, performedById: string, input: SyncMarketplaceOrderDto) {
    const existing = await this.prisma.salesOrder.findFirst({ where: { channelAccountId: input.channelAccountId, externalOrderId: input.externalOrderId, channelAccount: { organizationId } }, include: { items: true } });
    if (existing) return { order: existing, duplicated: true };
    const [channel, warehouse, mappings] = await Promise.all([
      this.prisma.salesChannelAccount.findFirst({ where: { id: input.channelAccountId, organizationId, active: true, type: { in: [ChannelType.SHOPEE, ChannelType.TIKTOK_SHOP] } } }),
      this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, branch: { organizationId } } }),
      this.prisma.channelSkuMapping.findMany({ where: { channelAccountId: input.channelAccountId, externalSkuId: { in: input.items.map((item) => item.externalSkuId) }, variant: { product: { organizationId, active: true } } }, include: { variant: true } }),
    ]);
    if (!channel || !warehouse) throw new NotFoundException('Seller hoặc kho nhận đơn không hợp lệ');
    const mappingByExternalSku = new Map(mappings.map((mapping) => [mapping.externalSkuId, mapping]));
    const missing = input.items.filter((item) => !mappingByExternalSku.has(item.externalSkuId));
    if (missing.length) throw new BadRequestException(`SKU sàn chưa ánh xạ: ${missing.map((item) => item.externalSkuId).join(', ')}`);
    const orderId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.salesOrder.findFirst({ where: { channelAccountId: channel.id, externalOrderId: input.externalOrderId } });
      if (duplicate) return { order: duplicate, duplicated: true };
      const normalized = input.items.map((item) => ({ ...item, variant: mappingByExternalSku.get(item.externalSkuId)!.variant }));
      for (const item of normalized) {
        const reserved = await tx.$executeRaw(Prisma.sql`
          UPDATE "InventoryBalance" SET "reserved" = "reserved" + ${item.quantity}
          WHERE "warehouseId" = ${warehouse.id} AND "variantId" = ${item.variant.id}
            AND ("onHand" - "reserved" - "quarantined" - "safetyStock") >= ${item.quantity}
        `);
        if (reserved !== 1) throw new BadRequestException(`Không đủ tồn cho SKU sàn ${item.externalSkuId}; đơn chưa được xác nhận`);
        await tx.inventoryTransaction.create({ data: { warehouseId: warehouse.id, variantId: item.variant.id, type: InventoryTransactionType.RESERVATION, quantity: item.quantity, reason: `Giữ tồn từ đơn đồng bộ ${channel.name}`, referenceType: 'SALES_ORDER', referenceId: orderId, performedById } });
      }
      const subtotal = normalized.reduce((sum, item) => sum.add(item.variant.salePrice.mul(item.quantity)), new Prisma.Decimal(0));
      const customer = input.customerName ? await tx.customer.create({ data: { organizationId, displayName: input.customerName } }) : null;
      const order = await tx.salesOrder.create({ data: { id: orderId, orderNumber: `${channel.code}-${input.externalOrderId}`, channelAccountId: channel.id, warehouseId: warehouse.id, customerId: customer?.id, externalOrderId: input.externalOrderId, externalStatus: 'CONFIRMED', externalStatusUpdatedAt: new Date(input.orderedAt), status: OrderStatus.CONFIRMED, subtotal, total: subtotal, orderedAt: new Date(input.orderedAt), items: { create: normalized.map((item) => ({ variantId: item.variant.id, quantity: item.quantity, unitPrice: item.variant.salePrice })) } }, include: { items: true, channelAccount: true, warehouse: true } });
      await queueInventorySync(tx, normalized.map((item) => item.variant.id), performedById, 'MARKETPLACE_ORDER_SYNCED');
      return { order, duplicated: false };
    });
  }

  async syncMarketplaceStatus(organizationId: string, channelAccountId: string, performedById: string, input: MarketplaceStatusInput) {
    const order = await this.prisma.salesOrder.findFirst({
      where: {
        channelAccountId,
        externalOrderId: input.externalOrderId,
        channelAccount: { organizationId, type: { in: [ChannelType.SHOPEE, ChannelType.TIKTOK_SHOP] } },
      },
      include: { items: { include: { variant: true } }, channelAccount: true },
    });
    if (!order || !order.warehouseId) throw new NotFoundException('Không tìm thấy đơn sàn hoặc đơn chưa được phân kho');
    const externalStatus = this.normalizeExternalStatus(input.externalStatus);
    if (!externalStatus) throw new BadRequestException('Trạng thái đơn từ sàn không hợp lệ');
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException('Thời gian cập nhật trạng thái sàn không hợp lệ');
    const cancelledStatuses = ['CANCELLED', 'CANCELED', 'CANCEL', 'VOIDED'];
    const shippedStatuses = ['SHIPPED', 'IN_TRANSIT', 'IN_DELIVERY'];
    const deliveredStatuses = ['DELIVERED', 'COMPLETED'];

    if (cancelledStatuses.includes(externalStatus)) {
      if (order.status === OrderStatus.CANCELLED) {
        const current = await this.prisma.salesOrder.update({ where: { id: order.id }, data: { externalStatus, externalStatusUpdatedAt: occurredAt } });
        return { order: current, action: 'ALREADY_CANCELLED', inventoryReleased: false };
      }
      const cancellable: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PACKING];
      if (!cancellable.includes(order.status)) {
        if (([OrderStatus.SHIPPED, OrderStatus.DELIVERED] as OrderStatus[]).includes(order.status)) {
          const updated = await this.prisma.$transaction(async (tx) => {
            const current = await tx.salesOrder.update({ where: { id: order.id }, data: { externalStatus, externalStatusUpdatedAt: occurredAt } });
            await tx.orderFulfillmentEvent.create({
              data: {
                orderId: order.id,
                action: 'CHANNEL_CANCEL_AFTER_DISPATCH',
                fromStatus: order.status,
                toStatus: order.status,
                performedById,
                carrierName: order.channelAccount.name,
                trackingCode: order.externalOrderId,
                note: 'Không cộng tồn; chuyển sang chờ đơn vị vận chuyển hoàn hàng về kho',
              },
            });
            return current;
          });
          return { order: updated, action: 'RETURN_PROCESS_REQUIRED', inventoryReleased: false, note: 'Đơn đã xuất kho; phải nhận hàng hoàn thực tế trước khi kiểm định và cộng tồn' };
        }
        if (([OrderStatus.RETURNED, OrderStatus.PARTIALLY_RETURNED] as OrderStatus[]).includes(order.status)) {
          const current = await this.prisma.salesOrder.update({ where: { id: order.id }, data: { externalStatus, externalStatusUpdatedAt: occurredAt } });
          return { order: current, action: 'RETURN_ALREADY_IN_PROGRESS', inventoryReleased: false };
        }
        throw new BadRequestException('Trạng thái nội bộ không cho phép hủy tự động');
      }
      return this.prisma.$transaction(async (tx) => {
        const changed = await tx.salesOrder.updateMany({
          where: { id: order.id, status: { in: cancellable } },
          data: { status: OrderStatus.CANCELLED, externalStatus, externalStatusUpdatedAt: occurredAt },
        });
        if (changed.count !== 1) throw new BadRequestException('Đơn vừa được tác vụ khác thay đổi; chưa giải phóng tồn');
        for (const item of order.items) {
          const released = await tx.$executeRaw(Prisma.sql`
            UPDATE "InventoryBalance" SET "reserved" = "reserved" - ${item.quantity}
            WHERE "warehouseId" = ${order.warehouseId} AND "variantId" = ${item.variantId}
              AND "reserved" >= ${item.quantity}
          `);
          if (released !== 1) throw new BadRequestException(`Tồn giữ chỗ SKU ${item.variant.sku} không đủ để giải phóng; giao dịch đã được hoàn tác`);
          await tx.inventoryTransaction.create({
            data: {
              warehouseId: order.warehouseId!,
              variantId: item.variantId,
              type: InventoryTransactionType.RESERVATION_RELEASE,
              quantity: item.quantity,
              reason: `Sàn hủy đơn: ${input.reasonCode ?? externalStatus}`,
              referenceType: 'SALES_ORDER',
              referenceId: order.id,
              performedById,
            },
          });
        }
        await tx.afterSaleRequest.create({
          data: {
            orderId: order.id,
            type: AfterSaleType.CANCELLATION,
            reasonCode: `CHANNEL_CANCEL|${input.reasonCode ?? externalStatus}`,
            responsibleParty: 'MARKETPLACE_OR_CUSTOMER',
            quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
            status: 'COMPLETED',
          },
        });
        await tx.orderFulfillmentEvent.create({
          data: {
            orderId: order.id,
            action: 'CHANNEL_CANCELLED_BEFORE_DISPATCH',
            fromStatus: order.status,
            toStatus: OrderStatus.CANCELLED,
            performedById,
            carrierName: order.channelAccount.name,
            trackingCode: order.externalOrderId,
            note: input.reasonCode ?? externalStatus,
          },
        });
        await queueInventorySync(tx, order.items.map((item) => item.variantId), performedById, 'CHANNEL_ORDER_CANCELLED');
        const updated = await tx.salesOrder.findUniqueOrThrow({ where: { id: order.id }, include: { channelAccount: true, items: true } });
        return { order: updated, action: 'CANCELLED_AND_RESERVATION_RELEASED', inventoryReleased: true };
      });
    }

    if (deliveredStatuses.includes(externalStatus) && order.status === OrderStatus.SHIPPED) {
      return this.prisma.$transaction(async (tx) => {
        const changed = await tx.salesOrder.updateMany({
          where: { id: order.id, status: OrderStatus.SHIPPED },
          data: { status: OrderStatus.DELIVERED, externalStatus, externalStatusUpdatedAt: occurredAt },
        });
        if (changed.count !== 1) throw new BadRequestException('Đơn vừa thay đổi trạng thái; vui lòng đồng bộ lại');
        await tx.orderFulfillmentEvent.create({
          data: {
            orderId: order.id,
            action: 'CHANNEL_DELIVERY_CONFIRMED',
            fromStatus: OrderStatus.SHIPPED,
            toStatus: OrderStatus.DELIVERED,
            performedById,
            carrierName: order.channelAccount.name,
            trackingCode: order.externalOrderId,
            note: `Sàn xác nhận ${externalStatus}`,
          },
        });
        return { order: await tx.salesOrder.findUniqueOrThrow({ where: { id: order.id } }), action: 'DELIVERED', inventoryReleased: false };
      });
    }

    const warehouseCompletedStatuses: OrderStatus[] = [OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.RETURNED, OrderStatus.PARTIALLY_RETURNED];
    const warehouseGateRequired = [...shippedStatuses, ...deliveredStatuses].includes(externalStatus) && !warehouseCompletedStatuses.includes(order.status);
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.salesOrder.update({ where: { id: order.id }, data: { externalStatus, externalStatusUpdatedAt: occurredAt } });
      if (warehouseGateRequired) {
        await tx.orderFulfillmentEvent.create({
          data: {
            orderId: order.id,
            action: 'CHANNEL_STATUS_WAITING_WAREHOUSE',
            fromStatus: order.status,
            toStatus: order.status,
            performedById,
            carrierName: order.channelAccount.name,
            trackingCode: order.externalOrderId,
            note: `Sàn báo ${externalStatus} nhưng kho chưa xác nhận xuất`,
          },
        });
      }
      return current;
    });
    return {
      order: updated,
      action: warehouseGateRequired ? 'WAREHOUSE_CONFIRMATION_REQUIRED' : 'EXTERNAL_STATUS_RECORDED',
      inventoryReleased: false,
      note: warehouseGateRequired ? 'Đã ghi trạng thái sàn nhưng giữ nguyên trạng thái nội bộ để chờ thủ kho xác nhận xuất' : undefined,
    };
  }

  async registerMarketplaceReturn(organizationId: string, channelAccountId: string, performedById: string, input: MarketplaceReturnInput) {
    const order = await this.prisma.salesOrder.findFirst({
      where: {
        channelAccountId,
        externalOrderId: input.externalOrderId,
        channelAccount: { organizationId, type: { in: [ChannelType.SHOPEE, ChannelType.TIKTOK_SHOP] } },
      },
      include: { items: true, afterSales: true, channelAccount: true },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn sàn cần hoàn');
    const eligible: OrderStatus[] = [OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.PARTIALLY_RETURNED];
    if (!eligible.includes(order.status)) throw new BadRequestException('Đơn chưa xuất kho; yêu cầu từ sàn phải xử lý là hủy đơn thay vì nhập hàng hoàn');
    if (order.afterSales.some((request) => request.reasonCode.includes(`SOURCE_EVENT:${input.sourceEventId}`))) {
      return { order, duplicated: true, created: 0, action: 'RETURN_ALREADY_REGISTERED' };
    }
    let requested: Array<{ variantId: string; quantity: number }>;
    if (input.items?.length) {
      const mappings = await this.prisma.channelSkuMapping.findMany({
        where: { channelAccountId, externalSkuId: { in: input.items.map((item) => item.externalSkuId) } },
      });
      const byExternalSku = new Map(mappings.map((mapping) => [mapping.externalSkuId, mapping.variantId]));
      requested = input.items.map((item) => ({ variantId: byExternalSku.get(item.externalSkuId) ?? '', quantity: item.quantity }));
      if (requested.some((item) => !item.variantId || !Number.isInteger(item.quantity) || item.quantity < 1)) throw new BadRequestException('Yêu cầu hoàn chứa SKU chưa ánh xạ hoặc số lượng không hợp lệ');
    } else {
      requested = order.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity }));
    }
    for (const item of requested) {
      const ordered = order.items.find((orderItem) => orderItem.variantId === item.variantId)?.quantity ?? 0;
      const alreadyRequested = order.afterSales.filter((request) => request.status !== 'REJECTED' && request.reasonCode.includes(`SKU:${item.variantId}`)).reduce((sum, request) => sum + request.quantity, 0);
      if (!ordered || alreadyRequested + item.quantity > ordered) throw new BadRequestException('Số lượng hoàn từ sàn vượt quá số lượng đã bán hoặc đã có yêu cầu trước đó');
    }
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException('Thời gian yêu cầu hoàn không hợp lệ');
    return this.prisma.$transaction(async (tx) => {
      await tx.afterSaleRequest.createMany({
        data: requested.map((item) => ({
          orderId: order.id,
          type: AfterSaleType.RETURN,
          reasonCode: `${input.reasonCode ?? 'MARKETPLACE_RETURN'}|SKU:${item.variantId}|SOURCE_EVENT:${input.sourceEventId}`,
          responsibleParty: 'CARRIER',
          quantity: item.quantity,
          status: 'AWAITING_RETURN',
        })),
      });
      await tx.salesOrder.update({ where: { id: order.id }, data: { externalStatus: 'RETURN_REQUESTED', externalStatusUpdatedAt: occurredAt } });
      await tx.orderFulfillmentEvent.create({
        data: {
          orderId: order.id,
          action: 'CHANNEL_RETURN_AWAITING_WAREHOUSE',
          fromStatus: order.status,
          toStatus: order.status,
          performedById,
          carrierName: order.channelAccount.name,
          trackingCode: order.externalOrderId,
          note: 'Chỉ nhập tồn kiểm định sau khi thủ kho nhận hàng hoàn thực tế',
        },
      });
      return {
        order: await tx.salesOrder.findUniqueOrThrow({ where: { id: order.id } }),
        duplicated: false,
        created: requested.length,
        action: 'RETURN_AWAITING_WAREHOUSE',
      };
    });
  }

  async cancel(organizationId: string, performedById: string, orderId: string, input: CancelOrderDto) {
    const order = await this.prisma.salesOrder.findFirst({ where: { id: orderId, channelAccount: { organizationId } }, include: { items: true } });
    if (!order || !order.warehouseId) throw new NotFoundException('Không tìm thấy đơn hàng');
    if (!([OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PACKING] as OrderStatus[]).includes(order.status)) throw new BadRequestException('Trạng thái đơn hàng không cho phép hủy');
    return this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        await tx.inventoryBalance.update({ where: { warehouseId_variantId: { warehouseId: order.warehouseId!, variantId: item.variantId } }, data: { reserved: { decrement: item.quantity } } });
        await tx.inventoryTransaction.create({ data: { warehouseId: order.warehouseId!, variantId: item.variantId, type: InventoryTransactionType.RESERVATION_RELEASE, quantity: item.quantity, reason: input.reasonCode, referenceType: 'SALES_ORDER', referenceId: order.id, performedById } });
      }
      await queueInventorySync(tx, order.items.map((item) => item.variantId), performedById, 'ORDER_CANCELLED');
      return tx.salesOrder.update({ where: { id: order.id }, data: { status: OrderStatus.CANCELLED, afterSales: { create: { type: AfterSaleType.CANCELLATION, reasonCode: input.reasonCode, responsibleParty: input.responsibleParty, quantity: order.items.reduce((sum, item) => sum + item.quantity, 0), status: 'COMPLETED' } } }, include: { afterSales: true } });
    });
  }

  async metrics(organizationId: string, from?: string, to?: string) {
    const orders = await this.prisma.salesOrder.findMany({
      where: { channelAccount: { organizationId }, ...(from || to ? { orderedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}) },
      include: { channelAccount: true, afterSales: true },
    });
    const total = orders.length;
    const cancelled = orders.filter((order) => order.status === OrderStatus.CANCELLED).length;
    const delivered = orders.filter((order) => ([OrderStatus.DELIVERED, OrderStatus.RETURNED, OrderStatus.PARTIALLY_RETURNED] as OrderStatus[]).includes(order.status)).length;
    const returned = orders.filter((order) => ([OrderStatus.RETURNED, OrderStatus.PARTIALLY_RETURNED] as OrderStatus[]).includes(order.status) || order.afterSales.some((item) => item.type === AfterSaleType.RETURN)).length;
    const exchanged = orders.filter((order) => order.afterSales.some((item) => item.type === AfterSaleType.EXCHANGE)).length;
    const byChannel = [...new Map(orders.map((order) => [order.channelAccountId, order.channelAccount])).values()].map((channel) => {
      const channelOrders = orders.filter((order) => order.channelAccountId === channel.id);
      const channelCancelled = channelOrders.filter((order) => order.status === OrderStatus.CANCELLED).length;
      return { id: channel.id, name: channel.name, type: channel.type, orders: channelOrders.length, revenue: channelOrders.filter((order) => order.status !== OrderStatus.CANCELLED).reduce((sum, order) => sum.add(order.total), new Prisma.Decimal(0)), cancellationRate: channelOrders.length ? channelCancelled / channelOrders.length : 0 };
    });
    return { total, cancelled, delivered, returned, exchanged, cancellationRate: total ? cancelled / total : 0, returnRate: delivered ? returned / delivered : 0, exchangeRate: delivered ? exchanged / delivered : 0, byChannel };
  }

  private normalizeExternalStatus(value: string) {
    return value.trim().toUpperCase().replace(/[\s.-]+/g, '_');
  }
}
