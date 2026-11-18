import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InventoryTransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';

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
      return balance;
    });
  }
}

