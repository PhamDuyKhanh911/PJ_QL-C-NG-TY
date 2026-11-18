import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AfterSaleType, ChannelType, InventoryTransactionType, OrderStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersDto } from './dto/list-orders.dto';
import { queueInventorySync } from '../channels/queue-inventory-sync';
import { SyncMarketplaceOrderDto } from './dto/sync-marketplace-order.dto';

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
      this.prisma.salesOrder.findMany({ where, include: { channelAccount: true, warehouse: true, customer: true, items: { include: { variant: { include: { product: true } } } }, afterSales: true }, orderBy: { orderedAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
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
      this.prisma.channelSkuMapping.findMany({ where: { channelAccountId: input.channelAccountId, externalSkuId: { in: input.items.map((item) => item.externalSkuId) } }, include: { variant: true } }),
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
      const order = await tx.salesOrder.create({ data: { id: orderId, orderNumber: `${channel.code}-${input.externalOrderId}`, channelAccountId: channel.id, warehouseId: warehouse.id, customerId: customer?.id, externalOrderId: input.externalOrderId, status: OrderStatus.CONFIRMED, subtotal, total: subtotal, orderedAt: new Date(input.orderedAt), items: { create: normalized.map((item) => ({ variantId: item.variant.id, quantity: item.quantity, unitPrice: item.variant.salePrice })) } }, include: { items: true, channelAccount: true, warehouse: true } });
      await queueInventorySync(tx, normalized.map((item) => item.variant.id), performedById, 'MARKETPLACE_ORDER_SYNCED');
      return { order, duplicated: false };
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
}
