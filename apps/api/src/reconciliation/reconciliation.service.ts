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
      const costAmount = rows.reduce((sum, row) => sum.add(row.platformFee).add(row.shippingFee).add(row.otherFee), new Prisma.Decimal(0));
      return { id: channel.id, code: channel.code, name: channel.name, type: channel.type, eligibleOrders: orders.length, reconciledOrders: rows.length, pendingOrders: orders.filter((order) => !settlementByOrder.has(order.id)).length, mismatchOrders: rows.filter((row) => row.status === ReconciliationStatus.MISMATCH).length, grossRevenue: rows.reduce((sum, row) => sum.add(row.grossAmount), new Prisma.Decimal(0)), paidAmount: rows.reduce((sum, row) => sum.add(row.paidAmount), new Prisma.Decimal(0)), refundAmount: rows.reduce((sum, row) => sum.add(row.refundAmount), new Prisma.Decimal(0)), deliveryCost: channel.type === 'OFFLINE_STORE' ? costAmount : new Prisma.Decimal(0), totalExpense: channel.type === 'OFFLINE_STORE' ? new Prisma.Decimal(0) : costAmount, costAmount, netRevenue: rows.reduce((sum, row) => sum.add(row.grossAmount).sub(row.refundAmount).sub(row.platformFee).sub(row.shippingFee).sub(row.otherFee), new Prisma.Decimal(0)), differenceAmount: rows.reduce((sum, row) => sum.add(row.differenceAmount), new Prisma.Decimal(0)) };
    });
    const totals = byChannel.reduce((sum, row) => ({ eligibleOrders: sum.eligibleOrders + row.eligibleOrders, reconciledOrders: sum.reconciledOrders + row.reconciledOrders, pendingOrders: sum.pendingOrders + row.pendingOrders, mismatchOrders: sum.mismatchOrders + row.mismatchOrders, grossRevenue: sum.grossRevenue.add(row.grossRevenue), paidAmount: sum.paidAmount.add(row.paidAmount), refundAmount: sum.refundAmount.add(row.refundAmount), deliveryCost: sum.deliveryCost.add(row.deliveryCost), totalExpense: sum.totalExpense.add(row.totalExpense), costAmount: sum.costAmount.add(row.costAmount), netRevenue: sum.netRevenue.add(row.netRevenue), differenceAmount: sum.differenceAmount.add(row.differenceAmount) }), { eligibleOrders: 0, reconciledOrders: 0, pendingOrders: 0, mismatchOrders: 0, grossRevenue: new Prisma.Decimal(0), paidAmount: new Prisma.Decimal(0), refundAmount: new Prisma.Decimal(0), deliveryCost: new Prisma.Decimal(0), totalExpense: new Prisma.Decimal(0), costAmount: new Prisma.Decimal(0), netRevenue: new Prisma.Decimal(0), differenceAmount: new Prisma.Decimal(0) });
    const issues = [
      ...eligibleOrders.filter((order) => !settlementByOrder.has(order.id)).map((order) => ({ type: 'UNPAID', orderId: order.id, channelAccountId: order.channelAccountId, amount: order.total })),
      ...settlements.filter((row) => row.status === ReconciliationStatus.MISMATCH).map((row) => ({ type: 'MISMATCH', orderId: row.orderId, orderNumber: row.order.orderNumber, channelAccountId: row.channelAccountId, amount: row.differenceAmount })),
    ];
    return { totals, byChannel, issues, recentSettlements: settlements.slice(0, 50) };
  }

  async receivables(organizationId: string) {
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        channelAccount: { organizationId },
        status: { in: [OrderStatus.DELIVERED, OrderStatus.PARTIALLY_RETURNED] },
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        orderedAt: true,
        total: true,
        channelAccount: { select: { id: true, code: true, name: true, type: true } },
        settlement: {
          select: {
            grossAmount: true,
            expectedNetAmount: true,
            paidAmount: true,
            status: true,
            settledAt: true,
          },
        },
      },
      orderBy: { orderedAt: 'asc' },
    });

    const generatedAt = new Date();
    const zero = () => new Prisma.Decimal(0);
    const rows = orders.map((order) => {
      const grossAmount = order.settlement?.grossAmount ?? order.total;
      const expectedAmount = order.settlement?.expectedNetAmount ?? order.total;
      const receivedAmount = order.settlement?.paidAmount ?? zero();
      const balance = expectedAmount.sub(receivedAmount);
      const outstandingAmount = balance.greaterThan(0) ? balance : zero();
      const overpaidAmount = balance.lessThan(0) ? balance.abs() : zero();
      const ageDays = Math.max(0, Math.floor((generatedAt.getTime() - order.orderedAt.getTime()) / 86_400_000));
      let collectionStatus: 'UNRECONCILED' | 'PARTIAL' | 'OVERDUE' | 'PAID' | 'OVERPAID' = 'PAID';
      if (!order.settlement) collectionStatus = ageDays > 7 ? 'OVERDUE' : 'UNRECONCILED';
      else if (overpaidAmount.greaterThan(1)) collectionStatus = 'OVERPAID';
      else if (outstandingAmount.greaterThan(1)) collectionStatus = ageDays > 7 ? 'OVERDUE' : 'PARTIAL';

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderStatus: order.status,
        orderedAt: order.orderedAt,
        ageDays,
        channel: order.channelAccount,
        grossAmount,
        expectedAmount,
        receivedAmount,
        outstandingAmount,
        overpaidAmount,
        collectionStatus,
        reconciliationStatus: order.settlement?.status ?? null,
        settledAt: order.settlement?.settledAt ?? null,
      };
    });

    const totals = rows.reduce(
      (sum, row) => ({
        orders: sum.orders + 1,
        openOrders: sum.openOrders + (row.outstandingAmount.greaterThan(1) ? 1 : 0),
        overdueOrders: sum.overdueOrders + (row.collectionStatus === 'OVERDUE' ? 1 : 0),
        grossAmount: sum.grossAmount.add(row.grossAmount),
        expectedAmount: sum.expectedAmount.add(row.expectedAmount),
        receivedAmount: sum.receivedAmount.add(row.receivedAmount),
        outstandingAmount: sum.outstandingAmount.add(row.outstandingAmount),
        overpaidAmount: sum.overpaidAmount.add(row.overpaidAmount),
      }),
      { orders: 0, openOrders: 0, overdueOrders: 0, grossAmount: zero(), expectedAmount: zero(), receivedAmount: zero(), outstandingAmount: zero(), overpaidAmount: zero() },
    );

    const aging = rows.reduce(
      (buckets, row) => {
        if (!row.outstandingAmount.greaterThan(1)) return buckets;
        const bucket = row.ageDays <= 7 ? 'current' : row.ageDays <= 14 ? 'warning' : row.ageDays <= 30 ? 'overdue' : 'critical';
        buckets[bucket].orders += 1;
        buckets[bucket].amount = buckets[bucket].amount.add(row.outstandingAmount);
        return buckets;
      },
      {
        current: { orders: 0, amount: zero() },
        warning: { orders: 0, amount: zero() },
        overdue: { orders: 0, amount: zero() },
        critical: { orders: 0, amount: zero() },
      },
    );

    const channelMap = new Map<string, {
      id: string;
      code: string;
      name: string;
      type: string;
      orders: number;
      openOrders: number;
      expectedAmount: Prisma.Decimal;
      receivedAmount: Prisma.Decimal;
      outstandingAmount: Prisma.Decimal;
    }>();
    for (const row of rows) {
      const current = channelMap.get(row.channel.id) ?? {
        ...row.channel,
        orders: 0,
        openOrders: 0,
        expectedAmount: zero(),
        receivedAmount: zero(),
        outstandingAmount: zero(),
      };
      current.orders += 1;
      current.openOrders += row.outstandingAmount.greaterThan(1) ? 1 : 0;
      current.expectedAmount = current.expectedAmount.add(row.expectedAmount);
      current.receivedAmount = current.receivedAmount.add(row.receivedAmount);
      current.outstandingAmount = current.outstandingAmount.add(row.outstandingAmount);
      channelMap.set(row.channel.id, current);
    }

    return {
      generatedAt,
      policy: { overdueAfterDays: 7, ageingFrom: 'ORDER_DATE' },
      totals,
      aging,
      byChannel: [...channelMap.values()].sort((a, b) => b.outstandingAmount.comparedTo(a.outstandingAmount)),
      rows: rows.sort((a, b) => {
        const priority = { OVERDUE: 0, UNRECONCILED: 1, PARTIAL: 2, OVERPAID: 3, PAID: 4 };
        return priority[a.collectionStatus] - priority[b.collectionStatus] || b.ageDays - a.ageDays;
      }),
    };
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
        const gross = new Prisma.Decimal(entry.grossAmount); const refund = new Prisma.Decimal(entry.refundAmount); const delivery = channel.type === 'OFFLINE_STORE' ? new Prisma.Decimal(entry.deliveryCost) : new Prisma.Decimal(0); const expense = channel.type === 'OFFLINE_STORE' ? new Prisma.Decimal(0) : new Prisma.Decimal(entry.totalExpense); const paid = new Prisma.Decimal(entry.paidAmount);
        const expected = gross.sub(refund).sub(delivery).sub(expense); const difference = paid.sub(expected);
        const status = !entry.settledAt && paid.equals(0) ? ReconciliationStatus.PENDING : difference.abs().lessThanOrEqualTo(1) ? ReconciliationStatus.MATCHED : ReconciliationStatus.MISMATCH;
        results.push(await tx.orderSettlement.upsert({ where: { orderId: order.id }, update: { externalSettlementId: entry.externalSettlementId, grossAmount: gross, platformFee: expense, shippingFee: delivery, refundAmount: refund, otherFee: 0, expectedNetAmount: expected, paidAmount: paid, differenceAmount: difference, status, settledAt: entry.settledAt ? new Date(entry.settledAt) : null, syncedById: userId }, create: { orderId: order.id, channelAccountId: channel.id, externalSettlementId: entry.externalSettlementId, grossAmount: gross, platformFee: expense, shippingFee: delivery, refundAmount: refund, otherFee: 0, expectedNetAmount: expected, paidAmount: paid, differenceAmount: difference, status, settledAt: entry.settledAt ? new Date(entry.settledAt) : undefined, syncedById: userId } }));
      }
      return { channel: { id: channel.id, name: channel.name }, processed: results.length, matched: results.filter((row) => row.status === ReconciliationStatus.MATCHED).length, mismatched: results.filter((row) => row.status === ReconciliationStatus.MISMATCH).length, pending: results.filter((row) => row.status === ReconciliationStatus.PENDING).length };
    });
  }
}
