import { Injectable, NotFoundException } from '@nestjs/common';
import { ChannelSyncStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(organizationId: string) {
    const channels = await this.prisma.salesChannelAccount.findMany({ where: { organizationId }, include: { skuMappings: { include: { variant: { include: { balances: true } } } }, syncRuns: { orderBy: { startedAt: 'desc' }, take: 5 }, _count: { select: { orders: true, conversations: true } } }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
    return channels.map((channel) => ({ id: channel.id, code: channel.code, name: channel.name, type: channel.type, active: channel.active, externalShopId: channel.externalShopId, mappedSkuCount: channel.skuMappings.length, availableUnits: channel.skuMappings.reduce((total, mapping) => total + mapping.variant.balances.reduce((sum, balance) => sum + Math.max(0, balance.onHand - balance.reserved - balance.quarantined - balance.safetyStock), 0), 0), orderCount: channel._count.orders, conversationCount: channel._count.conversations, recentSyncs: channel.syncRuns }));
  }
  async syncInventory(organizationId: string, channelId: string, userId: string) {
    const channel = await this.prisma.salesChannelAccount.findFirst({ where: { id: channelId, organizationId, active: true }, include: { skuMappings: { include: { variant: { include: { balances: { include: { warehouse: true } } } } } } } });
    if (!channel) throw new NotFoundException('Không tìm thấy kênh bán đang hoạt động');
    const snapshot = channel.skuMappings.map((mapping) => ({ sku: mapping.variant.sku, externalSkuId: mapping.externalSkuId, available: mapping.variant.balances.reduce((sum, balance) => sum + Math.max(0, balance.onHand - balance.reserved - balance.quarantined - balance.safetyStock), 0), warehouses: mapping.variant.balances.map((balance) => ({ warehouse: balance.warehouse.code, onHand: balance.onHand, reserved: balance.reserved, quarantined: balance.quarantined, safetyStock: balance.safetyStock })) }));
    return this.prisma.$transaction(async (tx) => {
      await tx.channelSyncRun.updateMany({ where: { channelAccountId: channel.id, status: ChannelSyncStatus.RUNNING }, data: { status: ChannelSyncStatus.SUCCEEDED, processedCount: snapshot.length, completedAt: new Date() } });
      return tx.channelSyncRun.create({ data: { channelAccountId: channel.id, status: ChannelSyncStatus.SUCCEEDED, mappedSkuCount: snapshot.length, processedCount: snapshot.length, snapshot, triggeredById: userId, completedAt: new Date() } });
    });
  }
  async syncSummary(organizationId: string) {
    const staleBefore = new Date(Date.now() - 15 * 60_000); const today = new Date(); today.setHours(0, 0, 0, 0);
    const [pending, stale, failed, succeededToday] = await Promise.all([
      this.prisma.channelSyncRun.count({ where: { channelAccount: { organizationId }, status: ChannelSyncStatus.RUNNING } }),
      this.prisma.channelSyncRun.count({ where: { channelAccount: { organizationId }, status: ChannelSyncStatus.RUNNING, startedAt: { lt: staleBefore } } }),
      this.prisma.channelSyncRun.count({ where: { channelAccount: { organizationId }, status: ChannelSyncStatus.FAILED } }),
      this.prisma.channelSyncRun.count({ where: { channelAccount: { organizationId }, status: ChannelSyncStatus.SUCCEEDED, completedAt: { gte: today } } }),
    ]);
    return { pending, stale, failed, succeededToday };
  }
  async processPending(organizationId: string, userId: string) {
    const pendingChannels = await this.prisma.salesChannelAccount.findMany({ where: { organizationId, active: true, syncRuns: { some: { status: ChannelSyncStatus.RUNNING } } }, select: { id: true } });
    const runs = []; for (const channel of pendingChannels) runs.push(await this.syncInventory(organizationId, channel.id, userId));
    return { processedChannels: runs.length, runs };
  }
}
