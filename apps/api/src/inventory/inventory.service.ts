import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InventoryTransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { InspectQuarantineDto, QuarantineDecision } from './dto/inspect-quarantine.dto';
import { ListInventoryTransactionsDto } from './dto/list-inventory-transactions.dto';
import { queueInventorySync } from '../channels/queue-inventory-sync';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async alerts(organizationId: string) {
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { warehouse: { branch: { organizationId } } },
      include: { warehouse: true, variant: { include: { product: true } } },
      orderBy: [{ warehouse: { name: 'asc' } }, { variant: { sku: 'asc' } }],
    });
    return balances
      .map((item) => ({ ...item, available: item.onHand - item.reserved - item.quarantined - item.safetyStock }))
      .filter((item) => item.available <= item.reorderPoint)
      .sort((a, b) => a.available - b.available);
  }

  async transactions(organizationId: string, query: ListInventoryTransactionsDto) {
    const matchingVariants = query.search ? await this.prisma.productVariant.findMany({ where: { product: { organizationId }, OR: [{ sku: { contains: query.search, mode: 'insensitive' } }, { name: { contains: query.search, mode: 'insensitive' } }, { product: { name: { contains: query.search, mode: 'insensitive' } } }] }, select: { id: true } }) : [];
    const where = { warehouse: { branch: { organizationId } }, ...(query.type ? { type: query.type } : {}), ...(query.search ? { variantId: { in: matchingVariants.map((item) => item.id) } } : {}), ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}) };
    const [rows, total] = await Promise.all([this.prisma.inventoryTransaction.findMany({ where, include: { warehouse: { include: { branch: true } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }), this.prisma.inventoryTransaction.count({ where })]);
    const variantIds = [...new Set(rows.map((item) => item.variantId))]; const userIds = [...new Set(rows.flatMap((item) => item.performedById ? [item.performedById] : []))];
    const [variants, users] = await Promise.all([this.prisma.productVariant.findMany({ where: { id: { in: variantIds } }, include: { product: true } }), this.prisma.user.findMany({ where: { id: { in: userIds }, organizationId }, select: { id: true, displayName: true, email: true } })]);
    const variantMap = new Map(variants.map((item) => [item.id, item])); const userMap = new Map(users.map((item) => [item.id, item]));
    return { data: rows.map((item) => ({ ...item, variant: variantMap.get(item.variantId) ?? null, performedBy: item.performedById ? userMap.get(item.performedById) ?? null : null })), meta: { total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) } };
  }

  quarantine(organizationId: string) {
    return this.prisma.inventoryBalance.findMany({ where: { quarantined: { gt: 0 }, warehouse: { branch: { organizationId } } }, include: { warehouse: { include: { branch: true } }, variant: { include: { product: true } } }, orderBy: [{ warehouse: { name: 'asc' } }, { variant: { sku: 'asc' } }] });
  }

  async inspectQuarantine(organizationId: string, userId: string, input: InspectQuarantineDto) {
    const balance = await this.prisma.inventoryBalance.findFirst({ where: { id: input.balanceId, warehouse: { branch: { organizationId } } }, include: { variant: true } });
    if (!balance) throw new NotFoundException('Không tìm thấy tồn kho cách ly');
    if (balance.quarantined < input.quantity) throw new BadRequestException('Số lượng xử lý vượt quá hàng đang cách ly');
    return this.prisma.$transaction(async (tx) => {
      const update = await tx.inventoryBalance.updateMany({ where: { id: balance.id, quarantined: { gte: input.quantity }, ...(input.decision === QuarantineDecision.WRITE_OFF ? { onHand: { gte: input.quantity } } : {}) }, data: { quarantined: { decrement: input.quantity }, ...(input.decision === QuarantineDecision.WRITE_OFF ? { onHand: { decrement: input.quantity } } : {}) } });
      if (update.count !== 1) throw new BadRequestException('Tồn cách ly đã thay đổi, vui lòng tải lại');
      await tx.inventoryTransaction.create({ data: { warehouseId: balance.warehouseId, variantId: balance.variantId, type: input.decision === QuarantineDecision.RELEASE ? InventoryTransactionType.QUARANTINE : InventoryTransactionType.RETURN_OUT, quantity: input.decision === QuarantineDecision.RELEASE ? input.quantity : -input.quantity, reason: `${input.decision}|${input.reason}`, referenceType: 'RETURN_INSPECTION', referenceId: balance.id, performedById: userId } });
      await queueInventorySync(tx, [balance.variantId], userId, input.decision === QuarantineDecision.RELEASE ? 'QUARANTINE_RELEASE' : 'RETURN_WRITE_OFF');
      return tx.inventoryBalance.findUnique({ where: { id: balance.id }, include: { warehouse: true, variant: { include: { product: true } } } });
    });
  }

  async adjust(organizationId: string, performedById: string, input: AdjustInventoryDto) {
    const [warehouse, variant] = await Promise.all([
      this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, branch: { organizationId } } }),
      this.prisma.productVariant.findFirst({ where: { id: input.variantId, product: { organizationId } } }),
    ]);
    if (!warehouse || !variant) throw new NotFoundException('Không tìm thấy kho hoặc SKU trong phạm vi được phép');

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.inventoryBalance.findUnique({
        where: { warehouseId_variantId: { warehouseId: warehouse.id, variantId: variant.id } },
      });
      const nextOnHand = (current?.onHand ?? 0) + input.quantity;
      if (nextOnHand < (current?.reserved ?? 0) + (current?.quarantined ?? 0)) {
        throw new BadRequestException('Điều chỉnh làm tồn thực tế thấp hơn số lượng đã giữ hoặc cách ly');
      }
      const balance = await tx.inventoryBalance.upsert({
        where: { warehouseId_variantId: { warehouseId: warehouse.id, variantId: variant.id } },
        update: { onHand: { increment: input.quantity } },
        create: { warehouseId: warehouse.id, variantId: variant.id, onHand: input.quantity },
      });
      await tx.inventoryTransaction.create({
        data: {
          warehouseId: warehouse.id,
          variantId: variant.id,
          type: InventoryTransactionType.ADJUSTMENT,
          quantity: input.quantity,
          reason: input.reason,
          referenceType: 'MANUAL_ADJUSTMENT',
          referenceId: input.referenceId,
          performedById,
        },
      });
      await queueInventorySync(tx, [variant.id], performedById, 'MANUAL_ADJUSTMENT');
      return balance;
    });
  }
}
