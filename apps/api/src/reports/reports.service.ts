import { Injectable } from '@nestjs/common';
import { AfterSaleType, ChannelType, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}
  async sales(organizationId: string, from?: string, to?: string) {
    const end = to ? new Date(`${to}T23:59:59.999`) : new Date(); const start = from ? new Date(`${from}T00:00:00`) : new Date(end.getTime() - 29 * 86_400_000);
    const orders = await this.prisma.salesOrder.findMany({ where: { channelAccount: { organizationId }, orderedAt: { gte: start, lte: end } }, include: { channelAccount: true, afterSales: true, items: { include: { variant: { include: { product: true } } } } }, orderBy: { orderedAt: 'asc' } });
    const valid = orders.filter((order) => order.status !== OrderStatus.CANCELLED); const revenue = valid.reduce((sum, order) => sum.add(order.total), new Prisma.Decimal(0));
    const offlineTypes: ChannelType[] = [ChannelType.OFFLINE_STORE, ChannelType.WHOLESALE];
    const summarize = (items: typeof orders) => ({ orders: items.length, revenue: items.filter((order) => order.status !== OrderStatus.CANCELLED).reduce((sum, order) => sum.add(order.total), new Prisma.Decimal(0)) });
    const cancelled = orders.filter((order) => order.status === OrderStatus.CANCELLED).length;
    const returnStatuses: OrderStatus[] = [OrderStatus.RETURNED, OrderStatus.PARTIALLY_RETURNED];
    const returned = orders.filter((order) => returnStatuses.includes(order.status) || order.afterSales.some((item) => item.type === AfterSaleType.RETURN)).length;
    const exchanged = orders.filter((order) => order.afterSales.some((item) => item.type === AfterSaleType.EXCHANGE)).length;
    const channelMap = new Map(orders.map((order) => [order.channelAccountId, order.channelAccount]));
    const byChannel = [...channelMap.values()].map((channel) => { const items = orders.filter((order) => order.channelAccountId === channel.id); const summary = summarize(items); const issues = items.filter((order) => order.status === OrderStatus.CANCELLED || returnStatuses.includes(order.status)).length; return { id: channel.id, name: channel.name, type: channel.type, ...summary, issueRate: items.length ? issues / items.length : 0 }; }).sort((a,b)=>Number(b.revenue)-Number(a.revenue));
    const productMap = new Map<string,{product:string;sku:string;quantity:number;revenue:Prisma.Decimal}>(); for(const order of valid) for(const item of order.items){const current=productMap.get(item.variantId)??{product:item.variant.product.name,sku:item.variant.sku,quantity:0,revenue:new Prisma.Decimal(0)};current.quantity+=item.quantity;current.revenue=current.revenue.add(item.unitPrice.mul(item.quantity));productMap.set(item.variantId,current)}
    const days = new Map<string,{date:string;orders:number;revenue:Prisma.Decimal}>(); for(const order of orders){const date=order.orderedAt.toISOString().slice(0,10);const current=days.get(date)??{date,orders:0,revenue:new Prisma.Decimal(0)};current.orders++;if(order.status!==OrderStatus.CANCELLED)current.revenue=current.revenue.add(order.total);days.set(date,current)}
    return { period:{from:start,to:end}, overview:{orders:orders.length,revenue,averageOrderValue:valid.length?revenue.div(valid.length):new Prisma.Decimal(0),cancelled,returned,exchanged,cancellationRate:orders.length?cancelled/orders.length:0,returnRate:valid.length?returned/valid.length:0,exchangeRate:valid.length?exchanged/valid.length:0}, online:summarize(orders.filter((order)=>!offlineTypes.includes(order.channelAccount.type))), offline:summarize(orders.filter((order)=>offlineTypes.includes(order.channelAccount.type))), byChannel, byDay:[...days.values()], topProducts:[...productMap.values()].sort((a,b)=>b.quantity-a.quantity).slice(0,10) };
  }
}
