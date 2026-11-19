import { ChannelSyncStatus, Prisma } from '@prisma/client';
export async function queueInventorySync(tx: Prisma.TransactionClient, variantIds: string[], userId: string | null, trigger: string) {
  const uniqueIds = [...new Set(variantIds)]; if (!uniqueIds.length) return;
  const mappings = await tx.channelSkuMapping.findMany({ where: { variantId: { in: uniqueIds }, channelAccount: { active: true } }, include: { variant: { include: { balances: true, product: { select: { active: true } } } } } });
  const grouped = new Map<string, typeof mappings>(); for (const mapping of mappings) grouped.set(mapping.channelAccountId, [...(grouped.get(mapping.channelAccountId) ?? []), mapping]);
  for (const [channelAccountId, channelMappings] of grouped) {
    const snapshot = channelMappings.map((mapping) => ({ sku: mapping.variant.sku, externalSkuId: mapping.externalSkuId, available: mapping.variant.product.active ? mapping.variant.balances.reduce((sum, balance) => sum + Math.max(0, balance.onHand - balance.reserved - balance.quarantined - balance.safetyStock), 0) : 0, trigger }));
    await tx.channelSyncRun.create({ data: { channelAccountId, status: ChannelSyncStatus.RUNNING, direction: `AUTO_${trigger}`, mappedSkuCount: snapshot.length, processedCount: 0, snapshot, triggeredById: userId } });
  }
}
