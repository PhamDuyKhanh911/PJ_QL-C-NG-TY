import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InventoryTransactionType, Prisma, PurchaseOrderStatus } from '@prisma/client';
import { queueInventorySync } from '../channels/queue-inventory-sync';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';

@Injectable()
export class PurchasingService {
  constructor(private readonly prisma: PrismaService) {}

  suppliers(organizationId: string) {
    return this.prisma.supplier.findMany({ where: { organizationId, active: true }, orderBy: { name: 'asc' } });
  }

  async suggestions(organizationId: string) {
    const [balances, incomingItems] = await Promise.all([
      this.prisma.inventoryBalance.findMany({
        where: { warehouse: { branch: { organizationId } } },
        include: { warehouse: true, variant: { include: { product: true } } },
        orderBy: [{ warehouse: { name: 'asc' } }, { variant: { sku: 'asc' } }],
      }),
      this.prisma.purchaseOrderItem.findMany({
        where: { purchaseOrder: { organizationId, status: { in: [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED] } } },
        select: { variantId: true, orderedQuantity: true, receivedQuantity: true, purchaseOrder: { select: { warehouseId: true } } },
      }),
    ]);
    const incoming = new Map<string, number>();
    for (const item of incomingItems) {
      const key = `${item.purchaseOrder.warehouseId}:${item.variantId}`;
      incoming.set(key, (incoming.get(key) ?? 0) + item.orderedQuantity - item.receivedQuantity);
    }
    return balances.map((item) => {
      const available = item.onHand - item.reserved - item.quarantined - item.safetyStock;
      const incomingQuantity = incoming.get(`${item.warehouseId}:${item.variantId}`) ?? 0;
      const projectedAvailable = available + incomingQuantity;
      return { ...item, available, incomingQuantity, projectedAvailable, suggestedQuantity: Math.max(item.reorderPoint * 2 - projectedAvailable, 0) };
    }).filter((item) => item.projectedAvailable <= item.reorderPoint && item.suggestedQuantity > 0);
  }

  orders(organizationId: string) {
    return this.prisma.purchaseOrder.findMany({
      where: { organizationId },
      include: { supplier: true, warehouse: true, items: { include: { variant: { include: { product: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(organizationId: string, userId: string, input: CreatePurchaseOrderDto) {
    if (!input.items.length) throw new BadRequestException('Đơn mua phải có ít nhất một sản phẩm');
    if (new Set(input.items.map((item) => item.variantId)).size !== input.items.length) throw new BadRequestException('Không được lặp SKU trong cùng đơn mua');
    const [supplier, warehouse, variants] = await Promise.all([
      this.prisma.supplier.findFirst({ where: { id: input.supplierId, organizationId, active: true } }),
      this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, branch: { organizationId } } }),
      this.prisma.productVariant.findMany({ where: { id: { in: input.items.map((item) => item.variantId) }, product: { organizationId } } }),
    ]);
    if (!supplier || !warehouse || variants.length !== input.items.length) throw new NotFoundException('Nhà cung cấp, kho hoặc SKU không hợp lệ');
    const suffix = `${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${organizationId}:${warehouse.id}:purchasing`})) IS NULL AS locked`);
      const suggestions = await this.suggestions(organizationId);
      const suggestedByVariant = new Map(suggestions.filter((item) => item.warehouseId === warehouse.id).map((item) => [item.variantId, item.suggestedQuantity]));
      for (const item of input.items) {
        const allowed = suggestedByVariant.get(item.variantId) ?? 0;
        const sku = variants.find((variant) => variant.id === item.variantId)?.sku;
        if (allowed === 0) throw new BadRequestException(`SKU ${sku} không còn nhu cầu bổ sung sau khi tính hàng đang về`);
        if (item.orderedQuantity > allowed) throw new BadRequestException(`Số lượng nhập vượt nhu cầu còn thiếu của SKU ${sku}; tối đa ${allowed}`);
      }
      return tx.purchaseOrder.create({
        data: { organizationId, supplierId: supplier.id, warehouseId: warehouse.id, orderNumber: `PO-${suffix}`, status: PurchaseOrderStatus.ORDERED, expectedAt: input.expectedAt ? new Date(input.expectedAt) : undefined, note: input.note, createdById: userId, items: { create: input.items } },
        include: { supplier: true, warehouse: true, items: { include: { variant: { include: { product: true } } } } },
      });
    });
  }

  async receive(organizationId: string, userId: string, orderId: string, input: ReceivePurchaseOrderDto) {
    if (!input.items.length) throw new BadRequestException('Cần nhập ít nhất một dòng hàng');
    if (new Set(input.items.map((item) => item.itemId)).size !== input.items.length) throw new BadRequestException('Không được lặp dòng hàng');
    const order = await this.prisma.purchaseOrder.findFirst({ where: { id: orderId, organizationId }, include: { items: true } });
    if (!order) throw new NotFoundException('Không tìm thấy đơn mua');
    if (order.status !== PurchaseOrderStatus.ORDERED && order.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED) throw new BadRequestException('Đơn mua không còn ở trạng thái có thể nhận hàng');
    const byId = new Map(order.items.map((item) => [item.id, item]));
    for (const received of input.items) {
      const item = byId.get(received.itemId);
      if (!item || received.quantity > item.orderedQuantity - item.receivedQuantity) throw new BadRequestException('Số lượng nhận vượt quá số còn chờ hoặc dòng hàng không hợp lệ');
    }
    return this.prisma.$transaction(async (tx) => {
      for (const received of input.items) {
        const item = byId.get(received.itemId)!;
        await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQuantity: { increment: received.quantity } } });
        await tx.inventoryBalance.upsert({ where: { warehouseId_variantId: { warehouseId: order.warehouseId, variantId: item.variantId } }, update: { onHand: { increment: received.quantity } }, create: { warehouseId: order.warehouseId, variantId: item.variantId, onHand: received.quantity } });
        await tx.inventoryTransaction.create({ data: { warehouseId: order.warehouseId, variantId: item.variantId, type: InventoryTransactionType.RECEIPT, quantity: received.quantity, referenceType: 'PURCHASE_ORDER', referenceId: order.id, reason: input.note ?? `Nhận hàng ${order.orderNumber}`, performedById: userId } });
      }
      const receivedMap = new Map(input.items.map((item) => [item.itemId, item.quantity]));
      const fullyReceived = order.items.every((item) => item.receivedQuantity + (receivedMap.get(item.id) ?? 0) >= item.orderedQuantity);
      await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: fullyReceived ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED } });
      await queueInventorySync(tx, input.items.map((received) => byId.get(received.itemId)!.variantId), userId, 'PURCHASE_RECEIVED');
      return tx.purchaseOrder.findUnique({ where: { id: order.id }, include: { supplier: true, warehouse: true, items: { include: { variant: { include: { product: true } } } } } });
    });
  }
}
