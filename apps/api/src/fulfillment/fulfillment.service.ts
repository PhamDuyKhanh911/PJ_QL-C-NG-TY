import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChannelType, InventoryTransactionType, OrderStatus, Prisma } from '@prisma/client';
import { queueInventorySync } from '../channels/queue-inventory-sync';
import { PrismaService } from '../prisma/prisma.service';
import { FulfillmentActionDto } from './dto/fulfillment-action.dto';

@Injectable()
export class FulfillmentService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    const orders = await this.prisma.salesOrder.findMany({
      where: { channelAccount: { organizationId }, status: { in: [OrderStatus.CONFIRMED, OrderStatus.SHIPPED] } },
      include: { channelAccount: true, warehouse: true, customer: true, items: { include: { variant: { include: { product: true } } } }, fulfillmentEvents: { orderBy: { createdAt: 'asc' } } },
      orderBy: { orderedAt: 'asc' },
    });
    const userIds = [...new Set(orders.flatMap((order) => [...order.fulfillmentEvents.map((event) => event.performedById), ...(order.responsibleUserId ? [order.responsibleUserId] : [])]))];
    const users = await this.prisma.user.findMany({ where: { organizationId, id: { in: userIds } }, select: { id: true, displayName: true, email: true } });
    const usersById = new Map(users.map((user) => [user.id, user]));
    return orders.map((order) => ({ ...order, responsibleUser: order.responsibleUserId ? usersById.get(order.responsibleUserId) ?? null : null, fulfillmentEvents: order.fulfillmentEvents.map((event) => ({ ...event, performedBy: usersById.get(event.performedById) ?? null, responsibleUser: event.responsibleUserId ? usersById.get(event.responsibleUserId) ?? null : null })) }));
  }

  handlers(organizationId: string) {
    return this.prisma.user.findMany({ where: { organizationId, active: true }, select: { id: true, displayName: true, email: true }, orderBy: { displayName: 'asc' } });
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
    const nextStatus = offline ? OrderStatus.DELIVERED : OrderStatus.SHIPPED;
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
