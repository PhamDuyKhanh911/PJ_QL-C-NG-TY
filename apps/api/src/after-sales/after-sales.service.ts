import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AfterSaleType, InventoryTransactionType, OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAfterSaleDto } from './dto/create-after-sale.dto';
import { ResolveAfterSaleDto } from './dto/resolve-after-sale.dto';
import { queueInventorySync } from '../channels/queue-inventory-sync';
import { DataScope, orderScopeWhere } from '../auth/data-scope';

@Injectable()
export class AfterSalesService {
  constructor(private readonly prisma: PrismaService) {}
  list(organizationId: string, status: string | undefined, scope: DataScope) {
    return this.prisma.afterSaleRequest.findMany({ where: { order: orderScopeWhere(organizationId, scope), ...(status ? { status } : {}) }, include: { order: { include: { channelAccount: true, customer: true, items: { include: { variant: { include: { product: true } } } } } } }, orderBy: { createdAt: 'desc' } });
  }
  async create(organizationId: string, input: CreateAfterSaleDto, scope: DataScope) {
    const order = await this.prisma.salesOrder.findFirst({ where: { AND: [{ id: input.orderId }, orderScopeWhere(organizationId, scope)] }, include: { items: true, afterSales: true } });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng');
    const eligibleStatuses: OrderStatus[] = [OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.PARTIALLY_RETURNED];
    if (!eligibleStatuses.includes(order.status)) throw new BadRequestException('Đơn hàng chưa đủ điều kiện tạo yêu cầu hậu mãi');
    const item = order.items.find((current) => current.variantId === input.variantId);
    if (!item) throw new BadRequestException('SKU không thuộc đơn hàng');
    const pendingOrDone = order.afterSales.filter((request) => request.status !== 'REJECTED').reduce((sum, request) => sum + request.quantity, 0);
    if (input.quantity + pendingOrDone > order.items.reduce((sum, current) => sum + current.quantity, 0)) throw new BadRequestException('Số lượng hậu mãi vượt quá số lượng đã mua');
    return this.prisma.afterSaleRequest.create({ data: { orderId: order.id, type: input.type, reasonCode: `${input.reasonCode}|SKU:${input.variantId}`, responsibleParty: input.responsibleParty, quantity: input.quantity, status: 'PENDING' }, include: { order: true } });
  }
  async resolve(organizationId: string, id: string, userId: string, input: ResolveAfterSaleDto, scope: DataScope) {
    const request = await this.prisma.afterSaleRequest.findFirst({ where: { id, order: orderScopeWhere(organizationId, scope) }, include: { order: { include: { items: true, afterSales: true } } } });
    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu hậu mãi');
    if (request.status !== 'PENDING') throw new BadRequestException('Yêu cầu đã được xử lý');
    if (!input.approved) return this.prisma.afterSaleRequest.update({ where: { id }, data: { status: 'REJECTED', reasonCode: `${request.reasonCode}|NOTE:${input.note ?? 'REJECTED'}` } });
    const returnTypes: AfterSaleType[] = [AfterSaleType.RETURN, AfterSaleType.EXCHANGE];
    const awaitingReturn = returnTypes.includes(request.type);
    return this.prisma.afterSaleRequest.update({ where: { id }, data: { status: awaitingReturn ? 'AWAITING_RETURN' : 'COMPLETED', reasonCode: `${request.reasonCode}|NOTE:${input.note ?? 'APPROVED'}` } });
  }
  async receive(organizationId: string, id: string, userId: string, note: string | undefined, scope: DataScope) {
    const request = await this.prisma.afterSaleRequest.findFirst({ where: { id, order: orderScopeWhere(organizationId, scope) }, include: { order: { include: { items: true, afterSales: true } } } });
    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu hậu mãi');
    if (request.status !== 'AWAITING_RETURN') throw new BadRequestException('Yêu cầu không ở trạng thái chờ hàng về kho');
    if (!request.order.warehouseId) throw new BadRequestException('Đơn hàng không có kho nhận hoàn');
    const variantId = request.reasonCode.split('|SKU:')[1]?.split('|')[0];
    if (!variantId || !request.order.items.some((item) => item.variantId === variantId)) throw new BadRequestException('Không xác định được SKU hoàn');
    return this.prisma.$transaction(async (tx) => {
      await tx.inventoryBalance.update({ where: { warehouseId_variantId: { warehouseId: request.order.warehouseId!, variantId } }, data: { quarantined: { increment: request.quantity }, onHand: { increment: request.quantity } } });
      await tx.inventoryTransaction.create({ data: { warehouseId: request.order.warehouseId!, variantId, type: InventoryTransactionType.RETURN_IN, quantity: request.quantity, reason: `RECEIVED_RETURN|${note ?? 'WAREHOUSE_CONFIRMED'}`, referenceType: 'AFTER_SALE', referenceId: request.id, performedById: userId } });
      await queueInventorySync(tx, [variantId], userId, 'RETURN_RECEIVED');
      const returnTypes: AfterSaleType[] = [AfterSaleType.RETURN, AfterSaleType.EXCHANGE];
      const receivedQuantity = request.order.afterSales.filter((item) => item.status === 'COMPLETED' && returnTypes.includes(item.type)).reduce((sum, item) => sum + item.quantity, 0) + request.quantity;
      const orderedQuantity = request.order.items.reduce((sum, item) => sum + item.quantity, 0);
      await tx.salesOrder.update({ where: { id: request.order.id }, data: { status: receivedQuantity >= orderedQuantity ? OrderStatus.RETURNED : OrderStatus.PARTIALLY_RETURNED } });
      return tx.afterSaleRequest.update({ where: { id }, data: { status: 'COMPLETED', reasonCode: `${request.reasonCode}|RECEIVED:${note ?? 'WAREHOUSE_CONFIRMED'}` } });
    });
  }
  async markLost(organizationId: string, id: string, note: string | undefined, scope: DataScope) {
    const request = await this.prisma.afterSaleRequest.findFirst({ where: { id, order: orderScopeWhere(organizationId, scope) } });
    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu hậu mãi');
    if (request.status !== 'AWAITING_RETURN') throw new BadRequestException('Chỉ có thể báo thất lạc khi đang chờ hàng về');
    return this.prisma.afterSaleRequest.update({ where: { id }, data: { status: 'LOST_IN_TRANSIT', responsibleParty: 'CARRIER', reasonCode: `${request.reasonCode}|LOST:${note ?? 'CARRIER_NOT_RETURNED'}` } });
  }
}
