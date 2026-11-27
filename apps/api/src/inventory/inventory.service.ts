import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AfterSaleType, InventoryReceiptSource, InventoryReceiptStatus, InventoryStocktakeStatus, InventoryTransactionType, OrderStatus, Prisma, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { InspectQuarantineDto, QuarantineDecision } from './dto/inspect-quarantine.dto';
import { ListInventoryTransactionsDto } from './dto/list-inventory-transactions.dto';
import { queueInventorySync } from '../channels/queue-inventory-sync';
import { DataScope, orderScopeWhere, warehouseScopeWhere } from '../auth/data-scope';
import { CreateStocktakeDto } from './dto/create-stocktake.dto';
import { UpdateStocktakeItemDto } from './dto/update-stocktake-item.dto';
import { InitializeInventoryDto } from './dto/initialize-inventory.dto';
import { CreateInventoryReceiptDto } from './dto/create-inventory-receipt.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async alerts(organizationId: string, scope: DataScope) {
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { warehouse: warehouseScopeWhere(organizationId, scope) },
      include: { warehouse: true, variant: { include: { product: true } } },
      orderBy: [{ warehouse: { name: 'asc' } }, { variant: { sku: 'asc' } }],
    });
    return balances
      .map((item) => ({ ...item, available: item.onHand - item.reserved - item.quarantined - item.safetyStock }))
      .filter((item) => item.available <= item.reorderPoint)
      .sort((a, b) => a.available - b.available);
  }

  warehouses(organizationId: string, scope: DataScope) {
    return this.prisma.warehouse.findMany({
      where: warehouseScopeWhere(organizationId, scope),
      include: { branch: { select: { id: true, code: true, name: true } }, _count: { select: { balances: true } } },
      orderBy: [{ branch: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  async stocktakes(organizationId: string, scope: DataScope) {
    const rows = await this.prisma.inventoryStocktake.findMany({
      where: { organizationId, warehouse: warehouseScopeWhere(organizationId, scope) },
      include: { warehouse: { include: { branch: true } }, items: { select: { expectedQuantity: true, countedQuantity: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const userIds = [...new Set(rows.flatMap((row) => [row.createdById, ...(row.completedById ? [row.completedById] : [])]))];
    const users = await this.prisma.user.findMany({ where: { organizationId, id: { in: userIds } }, select: { id: true, displayName: true, email: true } });
    const userById = new Map(users.map((user) => [user.id, user]));
    return rows.map((row) => ({
      ...row,
      createdBy: userById.get(row.createdById) ?? null,
      completedBy: row.completedById ? userById.get(row.completedById) ?? null : null,
      summary: {
        total: row.items.length,
        counted: row.items.filter((item) => item.countedQuantity !== null).length,
        different: row.items.filter((item) => item.countedQuantity !== null && item.countedQuantity !== item.expectedQuantity).length,
        netDifference: row.items.reduce((sum, item) => sum + (item.countedQuantity === null ? 0 : item.countedQuantity - item.expectedQuantity), 0),
      },
      items: undefined,
    }));
  }

  async stocktake(organizationId: string, id: string, scope: DataScope) {
    const row = await this.prisma.inventoryStocktake.findFirst({
      where: { id, organizationId, warehouse: warehouseScopeWhere(organizationId, scope) },
      include: {
        warehouse: { include: { branch: true } },
        items: { include: { variant: { include: { product: true } } }, orderBy: { variant: { sku: 'asc' } } },
      },
    });
    if (!row) throw new NotFoundException('Không tìm thấy phiên kiểm kê trong phạm vi được giao');
    const users = await this.prisma.user.findMany({ where: { organizationId, id: { in: [row.createdById, ...(row.completedById ? [row.completedById] : [])] } }, select: { id: true, displayName: true, email: true } });
    const userById = new Map(users.map((user) => [user.id, user]));
    return { ...row, createdBy: userById.get(row.createdById) ?? null, completedBy: row.completedById ? userById.get(row.completedById) ?? null : null };
  }

  async createStocktake(organizationId: string, userId: string, input: CreateStocktakeDto, scope: DataScope) {
    const warehouse = await this.prisma.warehouse.findFirst({ where: { AND: [{ id: input.warehouseId }, warehouseScopeWhere(organizationId, scope)] }, include: { branch: true } });
    if (!warehouse) throw new NotFoundException('Không tìm thấy kho trong phạm vi được giao');
    const active = await this.prisma.inventoryStocktake.findFirst({ where: { organizationId, warehouseId: warehouse.id, status: InventoryStocktakeStatus.DRAFT }, select: { code: true } });
    if (active) throw new ConflictException(`Kho đang có phiên ${active.code} chưa chốt hoặc hủy`);
    const balances = await this.prisma.inventoryBalance.findMany({ where: { warehouseId: warehouse.id, variantId: { in: input.variantIds } }, select: { variantId: true, onHand: true } });
    if (balances.length !== input.variantIds.length) throw new BadRequestException('Có SKU không tồn tại trong kho đã chọn');
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const code = `KK-${warehouse.code}-${stamp}`;
    const created = await this.prisma.$transaction(async (tx) => {
      const stocktake = await tx.inventoryStocktake.create({ data: { organizationId, warehouseId: warehouse.id, code, note: input.note?.trim() || null, createdById: userId } });
      await tx.inventoryStocktakeItem.createMany({ data: balances.map((balance) => ({ stocktakeId: stocktake.id, variantId: balance.variantId, expectedQuantity: balance.onHand })) });
      await tx.auditEvent.create({ data: { organizationId, actorId: userId, category: 'INVENTORY', action: 'STOCKTAKE_CREATED', entityType: 'INVENTORY_STOCKTAKE', entityId: stocktake.id, summary: `Mở phiên kiểm kê ${code} tại ${warehouse.name}`, metadata: { warehouseId: warehouse.id, itemCount: balances.length } } });
      return stocktake;
    });
    return this.stocktake(organizationId, created.id, scope);
  }

  async updateStocktakeItem(organizationId: string, stocktakeId: string, itemId: string, input: UpdateStocktakeItemDto, scope: DataScope) {
    const item = await this.prisma.inventoryStocktakeItem.findFirst({ where: { id: itemId, stocktakeId, stocktake: { organizationId, status: InventoryStocktakeStatus.DRAFT, warehouse: warehouseScopeWhere(organizationId, scope) } } });
    if (!item) throw new NotFoundException('Không tìm thấy dòng kiểm kê đang mở');
    return this.prisma.inventoryStocktakeItem.update({ where: { id: item.id }, data: { countedQuantity: input.countedQuantity, note: input.note?.trim() || null }, include: { variant: { include: { product: true } } } });
  }

  async finalizeStocktake(organizationId: string, userId: string, id: string, scope: DataScope) {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.inventoryStocktake.findFirst({ where: { id, organizationId, status: InventoryStocktakeStatus.DRAFT, warehouse: warehouseScopeWhere(organizationId, scope) }, include: { warehouse: true, items: { include: { variant: true } } } });
      if (!row) throw new NotFoundException('Phiên kiểm kê không còn ở trạng thái có thể chốt');
      const missing = row.items.filter((item) => item.countedQuantity === null);
      if (missing.length) throw new BadRequestException(`Còn ${missing.length} SKU chưa nhập số đếm thực tế`);
      const balances = await tx.inventoryBalance.findMany({ where: { warehouseId: row.warehouseId, variantId: { in: row.items.map((item) => item.variantId) } } });
      const balanceByVariant = new Map(balances.map((balance) => [balance.variantId, balance]));
      for (const item of row.items) {
        const balance = balanceByVariant.get(item.variantId);
        if (!balance || balance.onHand !== item.expectedQuantity) throw new ConflictException(`Tồn SKU ${item.variant.sku} đã phát sinh biến động sau khi mở kiểm kê; hãy hủy và mở phiên mới`);
        if (item.countedQuantity! < balance.reserved + balance.quarantined) throw new BadRequestException(`Số đếm SKU ${item.variant.sku} thấp hơn lượng đã giữ và cách ly`);
      }
      const changedVariantIds: string[] = [];
      for (const item of row.items) {
        const difference = item.countedQuantity! - item.expectedQuantity;
        if (!difference) continue;
        const updated = await tx.inventoryBalance.updateMany({ where: { warehouseId: row.warehouseId, variantId: item.variantId, onHand: item.expectedQuantity }, data: { onHand: { increment: difference } } });
        if (updated.count !== 1) throw new ConflictException(`Tồn SKU ${item.variant.sku} vừa thay đổi; chưa thể chốt kiểm kê`);
        await tx.inventoryTransaction.create({ data: { warehouseId: row.warehouseId, variantId: item.variantId, type: InventoryTransactionType.ADJUSTMENT, quantity: difference, reason: `Chốt kiểm kê ${row.code}${item.note ? ` · ${item.note}` : ''}`, referenceType: 'INVENTORY_STOCKTAKE', referenceId: row.id, performedById: userId } });
        changedVariantIds.push(item.variantId);
      }
      await tx.inventoryStocktake.update({ where: { id: row.id }, data: { status: InventoryStocktakeStatus.COMPLETED, completedById: userId, completedAt: new Date() } });
      await tx.auditEvent.create({ data: { organizationId, actorId: userId, category: 'INVENTORY', action: 'STOCKTAKE_COMPLETED', entityType: 'INVENTORY_STOCKTAKE', entityId: row.id, summary: `Chốt phiên kiểm kê ${row.code}`, metadata: { warehouseId: row.warehouseId, adjustedSkuCount: changedVariantIds.length } } });
      if (changedVariantIds.length) await queueInventorySync(tx, changedVariantIds, userId, 'STOCKTAKE_COMPLETED');
    });
    return this.stocktake(organizationId, id, scope);
  }

  async cancelStocktake(organizationId: string, userId: string, id: string, scope: DataScope) {
    const row = await this.prisma.inventoryStocktake.findFirst({ where: { id, organizationId, status: InventoryStocktakeStatus.DRAFT, warehouse: warehouseScopeWhere(organizationId, scope) }, include: { warehouse: true } });
    if (!row) throw new NotFoundException('Phiên kiểm kê không còn ở trạng thái có thể hủy');
    await this.prisma.$transaction([
      this.prisma.inventoryStocktake.update({ where: { id: row.id }, data: { status: InventoryStocktakeStatus.CANCELLED } }),
      this.prisma.auditEvent.create({ data: { organizationId, actorId: userId, category: 'INVENTORY', action: 'STOCKTAKE_CANCELLED', entityType: 'INVENTORY_STOCKTAKE', entityId: row.id, summary: `Hủy phiên kiểm kê ${row.code}`, metadata: { warehouseId: row.warehouseId } } }),
    ]);
    return this.stocktake(organizationId, id, scope);
  }

  async transactions(organizationId: string, query: ListInventoryTransactionsDto, scope: DataScope) {
    const matchingVariants = query.search ? await this.prisma.productVariant.findMany({ where: { product: { organizationId }, OR: [{ sku: { contains: query.search, mode: 'insensitive' } }, { name: { contains: query.search, mode: 'insensitive' } }, { product: { name: { contains: query.search, mode: 'insensitive' } } }] }, select: { id: true } }) : [];
    const where = { warehouse: warehouseScopeWhere(organizationId, scope), ...(query.type ? { type: query.type } : {}), ...(query.search ? { variantId: { in: matchingVariants.map((item) => item.id) } } : {}), ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}) };
    const [rows, total] = await Promise.all([this.prisma.inventoryTransaction.findMany({ where, include: { warehouse: { include: { branch: true } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }), this.prisma.inventoryTransaction.count({ where })]);
    const variantIds = [...new Set(rows.map((item) => item.variantId))]; const userIds = [...new Set(rows.flatMap((item) => item.performedById ? [item.performedById] : []))];
    const [variants, users] = await Promise.all([this.prisma.productVariant.findMany({ where: { id: { in: variantIds } }, include: { product: true } }), this.prisma.user.findMany({ where: { id: { in: userIds }, organizationId }, select: { id: true, displayName: true, email: true } })]);
    const variantMap = new Map(variants.map((item) => [item.id, item])); const userMap = new Map(users.map((item) => [item.id, item]));
    return { data: rows.map((item) => ({ ...item, variant: variantMap.get(item.variantId) ?? null, performedBy: item.performedById ? userMap.get(item.performedById) ?? null : null })), meta: { total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) } };
  }

  quarantine(organizationId: string, scope: DataScope) {
    return this.prisma.inventoryBalance.findMany({ where: { quarantined: { gt: 0 }, warehouse: warehouseScopeWhere(organizationId, scope) }, include: { warehouse: { include: { branch: true } }, variant: { include: { product: true } } }, orderBy: [{ warehouse: { name: 'asc' } }, { variant: { sku: 'asc' } }] });
  }

  async inspectQuarantine(organizationId: string, userId: string, input: InspectQuarantineDto, scope: DataScope) {
    const balance = await this.prisma.inventoryBalance.findFirst({ where: { id: input.balanceId, warehouse: warehouseScopeWhere(organizationId, scope) }, include: { variant: true } });
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

  async adjust(organizationId: string, performedById: string, input: AdjustInventoryDto, scope: DataScope) {
    const [warehouse, variant] = await Promise.all([
      this.prisma.warehouse.findFirst({ where: { AND: [{ id: input.warehouseId }, warehouseScopeWhere(organizationId, scope)] } }),
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

  async initializeStock(organizationId: string, performedById: string, input: InitializeInventoryDto, scope: DataScope) {
    const [warehouse, variant] = await Promise.all([
      this.prisma.warehouse.findFirst({ where: { AND: [{ id: input.warehouseId }, warehouseScopeWhere(organizationId, scope)] } }),
      this.prisma.productVariant.findFirst({ where: { id: input.variantId, product: { organizationId } }, include: { product: true } }),
    ]);
    if (!warehouse || !variant) throw new NotFoundException('Không tìm thấy kho hoặc SKU trong phạm vi được phép');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.inventoryBalance.findUnique({ where: { warehouseId_variantId: { warehouseId: warehouse.id, variantId: variant.id } } });
        if (existing) throw new ConflictException('SKU đã có tồn tại kho này; hãy dùng nhập hàng, kiểm kê hoặc điều chỉnh tồn kho');
        const balance = await tx.inventoryBalance.create({ data: { warehouseId: warehouse.id, variantId: variant.id, onHand: input.quantity } });
        await tx.inventoryTransaction.create({ data: { warehouseId: warehouse.id, variantId: variant.id, type: InventoryTransactionType.ADJUSTMENT, quantity: input.quantity, reason: `Tồn đầu kỳ${input.note?.trim() ? ` · ${input.note.trim()}` : ''}`, referenceType: 'INITIAL_STOCK', referenceId: balance.id, performedById } });
        await tx.auditEvent.create({ data: { organizationId, actorId: performedById, category: 'INVENTORY', action: 'INITIAL_STOCK_CREATED', entityType: 'INVENTORY_BALANCE', entityId: balance.id, summary: `Nhập tồn đầu kỳ ${input.quantity} sản phẩm cho SKU ${variant.sku} tại ${warehouse.name}`, metadata: { warehouseId: warehouse.id, warehouseName: warehouse.name, variantId: variant.id, sku: variant.sku, productName: variant.product.name, quantity: input.quantity, note: input.note?.trim() || null } } });
        await queueInventorySync(tx, [variant.id], performedById, 'INITIAL_STOCK');
        return balance;
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('SKU đã được nhập tồn tại kho này bởi một thao tác khác');
      throw error;
    }
  }

  async receipts(organizationId: string, scope: DataScope) {
    const rows = await this.prisma.inventoryReceipt.findMany({ where: { organizationId, warehouse: warehouseScopeWhere(organizationId, scope) }, include: { warehouse: true, items: { include: { variant: { include: { product: true } } } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    const userIds = [...new Set(rows.flatMap((row) => [row.createdById, ...(row.confirmedById ? [row.confirmedById] : [])]))];
    const users = await this.prisma.user.findMany({ where: { organizationId, id: { in: userIds } }, select: { id: true, displayName: true, email: true } });
    const byId = new Map(users.map((user) => [user.id, user]));
    return rows.map((row) => ({ ...row, createdBy: byId.get(row.createdById) ?? null, confirmedBy: row.confirmedById ? byId.get(row.confirmedById) ?? null : null }));
  }

  async createReceipt(organizationId: string, userId: string, input: CreateInventoryReceiptDto, scope: DataScope) {
    if (!input.items.length) throw new BadRequestException('Phiếu nhập cần ít nhất một sản phẩm');
    if (new Set(input.items.map((item) => item.variantId)).size !== input.items.length) throw new BadRequestException('Không được lặp SKU trong phiếu nhập');
    const [warehouse, variants] = await Promise.all([
      this.prisma.warehouse.findFirst({ where: { AND: [{ id: input.warehouseId }, warehouseScopeWhere(organizationId, scope)] } }),
      this.prisma.productVariant.findMany({ where: { id: { in: input.items.map((item) => item.variantId) }, product: { organizationId } } }),
    ]);
    if (!warehouse || variants.length !== input.items.length) throw new NotFoundException('Kho hoặc SKU không hợp lệ');
    let items = input.items.map((item) => ({ ...item, quarantined: Boolean(item.quarantined) }));
    if (input.source === InventoryReceiptSource.PURCHASE_ORDER) {
      if (!input.sourceReferenceId) throw new BadRequestException('Cần chọn đơn mua hàng');
      const order = await this.prisma.purchaseOrder.findFirst({ where: { id: input.sourceReferenceId, organizationId, warehouseId: warehouse.id, status: { in: [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED] } }, include: { items: true } });
      if (!order) throw new BadRequestException('Đơn mua không còn chờ nhập tại kho đã chọn');
      for (const item of items) { const ordered = order.items.find((row) => row.variantId === item.variantId); if (!ordered || item.quantity > ordered.orderedQuantity - ordered.receivedQuantity) throw new BadRequestException('SKU hoặc số lượng vượt quá phần còn chờ của đơn mua'); }
    }
    if (input.source === InventoryReceiptSource.CUSTOMER_RETURN) {
      if (!input.sourceReferenceId) throw new BadRequestException('Cần chọn yêu cầu hàng trả');
      const request = await this.prisma.afterSaleRequest.findFirst({ where: { id: input.sourceReferenceId, status: 'AWAITING_RETURN', order: orderScopeWhere(organizationId, scope) }, include: { order: { include: { items: true } } } });
      if (!request || request.order.warehouseId !== warehouse.id) throw new BadRequestException('Hàng trả không còn chờ nhập tại kho đã chọn');
      const existing = await this.prisma.inventoryReceipt.findFirst({ where: { source: InventoryReceiptSource.CUSTOMER_RETURN, sourceReferenceId: request.id, status: { not: InventoryReceiptStatus.CANCELLED } } });
      if (existing) throw new ConflictException(`Hàng trả đã có phiếu ${existing.code}`);
      const variantId = request.reasonCode.split('|SKU:')[1]?.split('|')[0];
      if (!variantId || items.length !== 1 || items[0].variantId !== variantId || items[0].quantity !== request.quantity) throw new BadRequestException('Phiếu nhập hàng trả phải đúng SKU và số lượng của yêu cầu');
      items = items.map((item) => ({ ...item, quarantined: true }));
    }
    const code = `PN-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Date.now().toString(36).toUpperCase()}`;
    return this.prisma.inventoryReceipt.create({ data: { organizationId, warehouseId: warehouse.id, code, source: input.source, sourceReferenceId: input.sourceReferenceId || null, note: input.note?.trim() || null, createdById: userId, items: { create: items } }, include: { warehouse: true, items: { include: { variant: { include: { product: true } } } } } });
  }

  async confirmReceipt(organizationId: string, userId: string, id: string, scope: DataScope) {
    const receipt = await this.prisma.inventoryReceipt.findFirst({ where: { id, organizationId, status: InventoryReceiptStatus.DRAFT, warehouse: warehouseScopeWhere(organizationId, scope) }, include: { warehouse: true, items: { include: { variant: true } } } });
    if (!receipt) throw new NotFoundException('Phiếu nhập không còn ở trạng thái chờ xác nhận');
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.inventoryReceipt.updateMany({ where: { id: receipt.id, status: InventoryReceiptStatus.DRAFT }, data: { status: InventoryReceiptStatus.CONFIRMED, confirmedById: userId, confirmedAt: new Date() } });
      if (claimed.count !== 1) throw new ConflictException('Phiếu nhập vừa được thủ kho khác xác nhận');
      let purchaseOrder: { id: string; warehouseId: string; items: Array<{ id: string; variantId: string; orderedQuantity: number; receivedQuantity: number }> } | null = null;
      if (receipt.source === InventoryReceiptSource.PURCHASE_ORDER) {
        purchaseOrder = await tx.purchaseOrder.findUnique({ where: { id: receipt.sourceReferenceId! }, include: { items: true } });
        if (!purchaseOrder || purchaseOrder.warehouseId !== receipt.warehouseId) throw new BadRequestException('Đơn mua không hợp lệ');
        for (const item of receipt.items) { const ordered = purchaseOrder.items.find((row) => row.variantId === item.variantId); if (!ordered || item.quantity > ordered.orderedQuantity - ordered.receivedQuantity) throw new ConflictException(`Số còn chờ của SKU ${item.variant.sku} đã thay đổi`); await tx.purchaseOrderItem.update({ where: { id: ordered.id }, data: { receivedQuantity: { increment: item.quantity } } }); }
      }
      let returnRequest: { id: string; orderId: string; quantity: number } | null = null;
      if (receipt.source === InventoryReceiptSource.CUSTOMER_RETURN) {
        returnRequest = await tx.afterSaleRequest.findFirst({ where: { id: receipt.sourceReferenceId!, status: 'AWAITING_RETURN' }, select: { id: true, orderId: true, quantity: true } });
        if (!returnRequest) throw new ConflictException('Yêu cầu hàng trả đã được xử lý');
      }
      for (const item of receipt.items) {
        await tx.inventoryBalance.upsert({ where: { warehouseId_variantId: { warehouseId: receipt.warehouseId, variantId: item.variantId } }, update: { onHand: { increment: item.quantity }, ...(item.quarantined ? { quarantined: { increment: item.quantity } } : {}) }, create: { warehouseId: receipt.warehouseId, variantId: item.variantId, onHand: item.quantity, quarantined: item.quarantined ? item.quantity : 0 } });
        await tx.inventoryTransaction.create({ data: { warehouseId: receipt.warehouseId, variantId: item.variantId, type: item.quarantined ? InventoryTransactionType.RETURN_IN : InventoryTransactionType.RECEIPT, quantity: item.quantity, reason: `${receipt.code}${receipt.note ? ` · ${receipt.note}` : ''}`, referenceType: 'INVENTORY_RECEIPT', referenceId: receipt.id, performedById: userId } });
      }
      if (purchaseOrder) {
        const updatedItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: purchaseOrder.id } });
        await tx.purchaseOrder.update({ where: { id: purchaseOrder.id }, data: { status: updatedItems.every((item) => item.receivedQuantity >= item.orderedQuantity) ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED } });
      }
      if (returnRequest) {
        await tx.afterSaleRequest.update({ where: { id: returnRequest.id }, data: { status: 'COMPLETED', reasonCode: { set: `RECEIVED_BY:${receipt.code}` } } });
        const order = await tx.salesOrder.findUniqueOrThrow({ where: { id: returnRequest.orderId }, include: { items: true, afterSales: true } });
        const returnTypes: AfterSaleType[] = [AfterSaleType.RETURN, AfterSaleType.EXCHANGE];
        const received = order.afterSales.filter((item) => item.status === 'COMPLETED' && returnTypes.includes(item.type)).reduce((sum, item) => sum + item.quantity, 0);
        await tx.salesOrder.update({ where: { id: order.id }, data: { status: received >= order.items.reduce((sum, item) => sum + item.quantity, 0) ? OrderStatus.RETURNED : OrderStatus.PARTIALLY_RETURNED } });
      }
      await tx.auditEvent.create({ data: { organizationId, actorId: userId, category: 'INVENTORY', action: 'INVENTORY_RECEIPT_CONFIRMED', entityType: 'INVENTORY_RECEIPT', entityId: receipt.id, summary: `Xác nhận phiếu nhập ${receipt.code} tại ${receipt.warehouse.name}`, metadata: { source: receipt.source, sourceReferenceId: receipt.sourceReferenceId, itemCount: receipt.items.length, totalQuantity: receipt.items.reduce((sum, item) => sum + item.quantity, 0) } } });
      await queueInventorySync(tx, receipt.items.map((item) => item.variantId), userId, 'INVENTORY_RECEIPT_CONFIRMED');
      return tx.inventoryReceipt.findUnique({ where: { id: receipt.id }, include: { warehouse: true, items: { include: { variant: { include: { product: true } } } } } });
    });
  }
}
