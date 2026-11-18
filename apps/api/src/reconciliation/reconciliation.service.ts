import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma, ReconciliationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SyncSettlementsDto } from './dto/sync-settlements.dto';

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(organizationId: string) {
    const eligibleStatuses = [OrderStatus.DELIVERED, OrderStatus.RETURNED, OrderStatus.PARTIALLY_RETURNED];
    const [channels, eligibleOrders, settlements] = await Promise.all([
      this.prisma.salesChannelAccount.findMany({ where: { organizationId, active: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
      this.prisma.salesOrder.findMany({ where: { channelAccount: { organizationId }, status: { in: eligibleStatuses } }, select: { id: true, channelAccountId: true, total: true } }),
      this.prisma.orderSettlement.findMany({ where: { channelAccount: { organizationId } }, include: { order: { select: { orderNumber: true } } }, orderBy: { updatedAt: 'desc' } }),
    ]);
    const settlementByOrder = new Map(settlements.map((item) => [item.orderId, item]));
    const byChannel = channels.map((channel) => {
      const orders = eligibleOrders.filter((order) => order.channelAccountId === channel.id);
      const rows = settlements.filter((row) => row.channelAccountId === channel.id);
      return { id: channel.id, code: channel.code, name: channel.name, type: channel.type, eligibleOrders: orders.length, reconciledOrders: rows.length, pendingOrders: orders.filter((order) => !settlementByOrder.has(order.id)).length, mismatchOrders: rows.filter((row) => row.status === ReconciliationStatus.MISMATCH).length, grossRevenue: orders.reduce((sum, order) => sum.add(order.total), new Prisma.Decimal(0)), paidAmount: rows.reduce((sum, row) => sum.add(row.paidAmount), new Prisma.Decimal(0)), totalFees: rows.reduce((sum, row) => sum.add(row.platformFee).add(row.shippingFee).add(row.otherFee), new Prisma.Decimal(0)), refundAmount: rows.reduce((sum, row) => sum.add(row.refundAmount), new Prisma.Decimal(0)), differenceAmount: rows.reduce((sum, row) => sum.add(row.differenceAmount), new Prisma.Decimal(0)) };
    });
    const totals = byChannel.reduce((sum, row) => ({ eligibleOrders: sum.eligibleOrders + row.eligibleOrders, reconciledOrders: sum.reconciledOrders + row.reconciledOrders, pendingOrders: sum.pendingOrders + row.pendingOrders, mismatchOrders: sum.mismatchOrders + row.mismatchOrders, grossRevenue: sum.grossRevenue.add(row.grossRevenue), paidAmount: sum.paidAmount.add(row.paidAmount), totalFees: sum.totalFees.add(row.totalFees), refundAmount: sum.refundAmount.add(row.refundAmount), differenceAmount: sum.differenceAmount.add(row.differenceAmount) }), { eligibleOrders: 0, reconciledOrders: 0, pendingOrders: 0, mismatchOrders: 0, grossRevenue: new Prisma.Decimal(0), paidAmount: new Prisma.Decimal(0), totalFees: new Prisma.Decimal(0), refundAmount: new Prisma.Decimal(0), differenceAmount: new Prisma.Decimal(0) });
    const issues = [
      ...eligibleOrders.filter((order) => !settlementByOrder.has(order.id)).map((order) => ({ type: 'UNPAID', orderId: order.id, channelAccountId: order.channelAccountId, amount: order.total })),
      ...settlements.filter((row) => row.status === ReconciliationStatus.MISMATCH).map((row) => ({ type: 'MISMATCH', orderId: row.orderId, orderNumber: row.order.orderNumber, channelAccountId: row.channelAccountId, amount: row.differenceAmount })),
    ];
    return { totals, byChannel, issues, recentSettlements: settlements.slice(0, 50) };
  }

  async sync(organizationId: string, userId: string, input: SyncSettlementsDto) {
    const channel = await this.prisma.salesChannelAccount.findFirst({ where: { id: input.channelAccountId, organizationId, active: true } });
    if (!channel) throw new NotFoundException('Không tìm thấy gian hàng');
    const orderNumbers = input.entries.map((entry) => entry.orderNumber);
    if (new Set(orderNumbers).size !== orderNumbers.length) throw new BadRequestException('Dữ liệu đối soát có mã đơn trùng');
    const orders = await this.prisma.salesOrder.findMany({ where: { orderNumber: { in: orderNumbers }, channelAccountId: channel.id } });
    if (orders.length !== input.entries.length) throw new BadRequestException('Có mã đơn không tồn tại hoặc không thuộc gian hàng đã chọn');
    const orderByNumber = new Map(orders.map((order) => [order.orderNumber, order]));
    return this.prisma.$transaction(async (tx) => {
      const results = [];
      for (const entry of input.entries) {
        const order = orderByNumber.get(entry.orderNumber)!;
        const gross = new Prisma.Decimal(entry.grossAmount); const platform = new Prisma.Decimal(entry.platformFee); const shipping = new Prisma.Decimal(entry.shippingFee); const refund = new Prisma.Decimal(entry.refundAmount); const other = new Prisma.Decimal(entry.otherFee); const paid = new Prisma.Decimal(entry.paidAmount);
        const expected = gross.sub(platform).sub(shipping).sub(refund).sub(other); const difference = paid.sub(expected);
        const status = !entry.settledAt && paid.equals(0) ? ReconciliationStatus.PENDING : difference.abs().lessThanOrEqualTo(1) ? ReconciliationStatus.MATCHED : ReconciliationStatus.MISMATCH;
        results.push(await tx.orderSettlement.upsert({ where: { orderId: order.id }, update: { externalSettlementId: entry.externalSettlementId, grossAmount: gross, platformFee: platform, shippingFee: shipping, refundAmount: refund, otherFee: other, expectedNetAmount: expected, paidAmount: paid, differenceAmount: difference, status, settledAt: entry.settledAt ? new Date(entry.settledAt) : null, syncedById: userId }, create: { orderId: order.id, channelAccountId: channel.id, externalSettlementId: entry.externalSettlementId, grossAmount: gross, platformFee: platform, shippingFee: shipping, refundAmount: refund, otherFee: other, expectedNetAmount: expected, paidAmount: paid, differenceAmount: difference, status, settledAt: entry.settledAt ? new Date(entry.settledAt) : undefined, syncedById: userId } }));
      }
      return { channel: { id: channel.id, name: channel.name }, processed: results.length, matched: results.filter((row) => row.status === ReconciliationStatus.MATCHED).length, mismatched: results.filter((row) => row.status === ReconciliationStatus.MISMATCH).length, pending: results.filter((row) => row.status === ReconciliationStatus.PENDING).length };
    });
  }
}
