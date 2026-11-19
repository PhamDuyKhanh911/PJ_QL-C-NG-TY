import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChannelType, InventoryTransactionType, OrderStatus, Prisma } from '@prisma/client';
import { queueInventorySync } from '../channels/queue-inventory-sync';
import { PrismaService } from '../prisma/prisma.service';
import { FulfillmentActionDto } from './dto/fulfillment-action.dto';
import { BatchDispatchDto } from './dto/batch-dispatch.dto';

@Injectable()
export class FulfillmentService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    const orders = await this.prisma.salesOrder.findMany({
      where: { channelAccount: { organizationId }, status: { in: [OrderStatus.CONFIRMED, OrderStatus.PACKING, OrderStatus.SHIPPED] } },
      include: { channelAccount: true, warehouse: true, customer: true, items: { include: { variant: { include: { product: true } } } }, fulfillmentEvents: { orderBy: { createdAt: 'asc' } } },
      orderBy: { orderedAt: 'asc' },
    });
    const userIds = [...new Set(orders.flatMap((order) => [...order.fulfillmentEvents.map((event) => event.performedById), ...(order.responsibleUserId ? [order.responsibleUserId] : [])]))];
    const users = await this.prisma.user.findMany({ where: { organizationId, id: { in: userIds } }, select: { id: true, displayName: true, email: true } });
    const usersById = new Map(users.map((user) => [user.id, user]));
    return orders.map((order) => ({ ...order, responsibleUser: order.responsibleUserId ? usersById.get(order.responsibleUserId) ?? null : null, fulfillmentEvents: order.fulfillmentEvents.map((event) => ({ ...event, performedBy: usersById.get(event.performedById) ?? null, responsibleUser: event.responsibleUserId ? usersById.get(event.responsibleUserId) ?? null : null })) }));
  }

  async handlers(organizationId: string, warehouseKeeperId: string) {
    return this.prisma.user.findMany({ where: { organizationId, active: true, id: { not: warehouseKeeperId } }, select: { id: true, displayName: true, email: true }, orderBy: { displayName: 'asc' } });
  }

  async detail(organizationId: string, orderId: string) {
    const order = await this.prisma.salesOrder.findFirst({ where: { id: orderId, channelAccount: { organizationId } }, include: { channelAccount: true, warehouse: { include: { branch: true } }, items: { include: { variant: { include: { product: true } } } }, fulfillmentEvents: { orderBy: { createdAt: 'asc' } } } });
    if (!order) throw new NotFoundException('Không tìm thấy phiếu xuất');
    const userIds = [...new Set([...(order.responsibleUserId ? [order.responsibleUserId] : []), ...order.fulfillmentEvents.map((event) => event.performedById)])];
    const users = await this.prisma.user.findMany({ where: { organizationId, id: { in: userIds } }, select: { id: true, displayName: true, email: true } });
    const usersById = new Map(users.map((user) => [user.id, user]));
    return { ...order, responsibleUser: order.responsibleUserId ? usersById.get(order.responsibleUserId) ?? null : null, fulfillmentEvents: order.fulfillmentEvents.map((event) => ({ ...event, performedBy: usersById.get(event.performedById) ?? null })) };
  }

  async batchDetail(organizationId: string, batchCode: string) {
    const events = await this.prisma.orderFulfillmentEvent.findMany({
      where: { batchCode, order: { channelAccount: { organizationId } } },
      include: {
        order: {
          include: {
            channelAccount: true,
            warehouse: { include: { branch: true } },
            items: { include: { variant: { include: { product: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!events.length) throw new NotFoundException('Không tìm thấy lượt bàn giao');
    const orderIds = new Set<string>();
    const uniqueEvents = events.filter((event) => {
      if (orderIds.has(event.orderId)) return false;
      orderIds.add(event.orderId);
      return true;
    });
    const first = uniqueEvents[0]!;
    const userIds = [...new Set(uniqueEvents.flatMap((event) => [event.performedById, ...(event.responsibleUserId ? [event.responsibleUserId] : [])]))];
    const users = await this.prisma.user.findMany({ where: { organizationId, id: { in: userIds } }, select: { id: true, displayName: true, email: true } });
    const usersById = new Map(users.map((user) => [user.id, user]));
    const totals = new Map<string, { variantId: string; sku: string; name: string; variantName: string; quantity: number }>();
    for (const event of uniqueEvents) for (const item of event.order.items) {
      const current = totals.get(item.variantId);
      totals.set(item.variantId, {
        variantId: item.variantId,
        sku: item.variant.sku,
        name: item.variant.product.name,
        variantName: item.variant.name,
        quantity: (current?.quantity ?? 0) + item.quantity,
      });
    }
    return {
      batchCode,
      createdAt: first.createdAt,
      channelAccount: first.order.channelAccount,
      warehouse: first.order.warehouse,
      warehouseKeeper: usersById.get(first.performedById) ?? null,
      responsibleUser: first.responsibleUserId ? usersById.get(first.responsibleUserId) ?? null : null,
      orderCount: uniqueEvents.length,
      totalQuantity: [...totals.values()].reduce((sum, item) => sum + item.quantity, 0),
      totals: [...totals.values()].sort((a, b) => a.sku.localeCompare(b.sku)),
      orders: uniqueEvents.map((event) => ({
        id: event.order.id,
        orderNumber: event.order.orderNumber,
        externalOrderId: event.order.externalOrderId,
        items: event.order.items,
      })),
    };
  }

  async batchDispatch(organizationId: string, warehouseKeeperId: string, input: BatchDispatchDto) {
    const responsibleUser = await this.prisma.user.findFirst({ where: { id: input.responsibleUserId, organizationId, active: true }, select: { id: true, displayName: true, email: true } });
    if (!responsibleUser) throw new BadRequestException('Nhân viên nhận đóng gói không hợp lệ hoặc đã ngừng hoạt động');
    if (responsibleUser.id === warehouseKeeperId) throw new BadRequestException('Người nhận đóng gói phải khác thủ kho giao hàng');
    if (new Set(input.orderIds).size !== input.orderIds.length) throw new BadRequestException('Danh sách đơn bị trùng');
    const channel = await this.prisma.salesChannelAccount.findFirst({ where: { id: input.channelAccountId, organizationId, active: true } });
    if (!channel || channel.type === ChannelType.OFFLINE_STORE) throw new BadRequestException('Chỉ áp dụng xuất gộp cho gian hàng online');
    const orders = await this.prisma.salesOrder.findMany({ where: { id: { in: input.orderIds }, channelAccountId: channel.id, status: OrderStatus.CONFIRMED }, include: { items: { include: { variant: true } } } });
    if (orders.length !== input.orderIds.length) throw new BadRequestException('Có đơn không còn ở trạng thái chờ xuất hoặc không thuộc cùng gian hàng');
    const warehouseIds = [...new Set(orders.map((order) => order.warehouseId))];
    if (warehouseIds.length !== 1 || !warehouseIds[0]) throw new BadRequestException('Các đơn trong lượt xuất phải thuộc cùng một kho');
    const warehouseId = warehouseIds[0];
    const batchCode = `BATCH-${channel.code}-${Date.now().toString(36).toUpperCase()}`;
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.salesOrder.updateMany({ where: { id: { in: input.orderIds }, channelAccountId: channel.id, status: OrderStatus.CONFIRMED }, data: { status: OrderStatus.SHIPPED, responsibleUserId: responsibleUser.id, responsibilityAssignedAt: new Date() } });
      if (changed.count !== orders.length) throw new BadRequestException('Một hoặc nhiều đơn vừa được thủ kho khác xử lý');
      const totals = new Map<string, { quantity: number; sku: string }>();
      for (const order of orders) for (const item of order.items) {
        const current = totals.get(item.variantId);
        totals.set(item.variantId, { quantity: (current?.quantity ?? 0) + item.quantity, sku: item.variant.sku });
      }
      for (const [variantId, total] of totals) {
        const issued = await tx.$executeRaw(Prisma.sql`
          UPDATE "InventoryBalance" SET "onHand" = "onHand" - ${total.quantity}, "reserved" = "reserved" - ${total.quantity}
          WHERE "warehouseId" = ${warehouseId} AND "variantId" = ${variantId}
            AND "onHand" >= ${total.quantity} AND "reserved" >= ${total.quantity}
        `);
        if (issued !== 1) throw new BadRequestException(`SKU ${total.sku} không đủ tồn đã giữ để xuất gộp`);
        await tx.inventoryTransaction.create({ data: { warehouseId, variantId, type: InventoryTransactionType.SALE, quantity: -total.quantity, referenceType: 'FULFILLMENT_BATCH', referenceId: batchCode, reason: `Xuất gộp ${channel.name}: ${orders.length} đơn`, performedById: warehouseKeeperId } });
      }
      await tx.orderFulfillmentEvent.createMany({ data: orders.map((order) => ({ orderId: order.id, action: 'WAREHOUSE_BATCH_DISPATCHED', fromStatus: OrderStatus.CONFIRMED, toStatus: OrderStatus.SHIPPED, performedById: warehouseKeeperId, responsibleUserId: responsibleUser.id, carrierName: channel.name, trackingCode: order.externalOrderId, batchCode, note: `Bàn giao cho ${responsibleUser.displayName} đóng gói; phiếu ${batchCode}` })) });
      await queueInventorySync(tx, [...totals.keys()], warehouseKeeperId, 'ONLINE_BATCH_DISPATCHED');
      return { batchCode, channel: { id: channel.id, name: channel.name, type: channel.type }, responsibleUser, orderCount: orders.length, skuTotals: [...totals.entries()].map(([variantId, item]) => ({ variantId, ...item })) };
    });
  }

  async dispatch(organizationId: string, warehouseKeeperId: string, orderId: string, input: FulfillmentActionDto) {
    const order = await this.prisma.salesOrder.findFirst({ where: { id: orderId, channelAccount: { organizationId } }, include: { channelAccount: true, items: { include: { variant: true } } } });
    if (!order || !order.warehouseId) throw new NotFoundException('Không tìm thấy đơn hoặc đơn chưa được phân kho');
    if (order.status !== OrderStatus.CONFIRMED) throw new BadRequestException('Chỉ đơn đã xác nhận và chưa xuất mới được xuất kho');
    const offline = order.channelAccount.type === ChannelType.OFFLINE_STORE;
    const responsibleUser = order.responsibleUserId ? await this.prisma.user.findFirst({ where: { id: order.responsibleUserId, organizationId, active: true } }) : null;
    if (offline && !responsibleUser) throw new BadRequestException('Phiếu offline chưa chọn nhân viên nhận để đóng hàng');
    const officialMarketplace = order.channelAccount.type === ChannelType.SHOPEE || order.channelAccount.type === ChannelType.TIKTOK_SHOP;
    if (!offline && !officialMarketplace && (!input.carrierName || !input.trackingCode)) throw new BadRequestException('Đơn Facebook/online cần đơn vị vận chuyển và mã vận đơn');
    const nextStatus = offline ? OrderStatus.PACKING : OrderStatus.SHIPPED;
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.salesOrder.updateMany({ where: { id: order.id, status: OrderStatus.CONFIRMED }, data: { status: nextStatus } });
      if (changed.count !== 1) throw new BadRequestException('Đơn đã được thủ kho khác xuất hoặc trạng thái đã thay đổi');
      for (const item of order.items) {
        const issued = await tx.$executeRaw(Prisma.sql`
          UPDATE "InventoryBalance"
          SET "onHand" = "onHand" - ${item.quantity}, "reserved" = "reserved" - ${item.quantity}
          WHERE "warehouseId" = ${order.warehouseId} AND "variantId" = ${item.variantId}
            AND "onHand" >= ${item.quantity} AND "reserved" >= ${item.quantity}
        `);
        if (issued !== 1) throw new BadRequestException(`SKU ${item.variant.sku} không còn đủ tồn đã giữ để xuất`);
        await tx.inventoryTransaction.create({ data: { warehouseId: order.warehouseId!, variantId: item.variantId, type: InventoryTransactionType.SALE, quantity: -item.quantity, referenceType: 'SALES_ORDER', referenceId: order.id, reason: offline ? 'Thủ kho xuất bán tại quầy' : `Thủ kho bàn giao ${input.carrierName ?? order.channelAccount.name} - ${input.trackingCode ?? order.externalOrderId ?? 'Mã từ sàn'}`, performedById: warehouseKeeperId } });
      }
      await tx.orderFulfillmentEvent.create({ data: { orderId: order.id, action: 'WAREHOUSE_DISPATCHED', fromStatus: OrderStatus.CONFIRMED, toStatus: nextStatus, performedById: warehouseKeeperId, responsibleUserId: responsibleUser?.id, carrierName: offline ? `Nội bộ: ${responsibleUser?.displayName}` : input.carrierName ?? order.channelAccount.name, trackingCode: input.trackingCode ?? order.externalOrderId, note: input.note } });
      await queueInventorySync(tx, order.items.map((item) => item.variantId), warehouseKeeperId, offline ? 'OFFLINE_DISPATCHED' : 'ORDER_DISPATCHED');
      return tx.salesOrder.findUnique({ where: { id: order.id }, include: { channelAccount: true, fulfillmentEvents: true } });
    });
  }

}
