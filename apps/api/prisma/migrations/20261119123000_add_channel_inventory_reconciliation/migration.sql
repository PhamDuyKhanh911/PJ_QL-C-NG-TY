CREATE TABLE "ChannelInventoryReconciliation" (
  "id" TEXT NOT NULL,
  "channelAccountId" TEXT NOT NULL,
  "externalProductId" TEXT,
  "externalSkuId" TEXT NOT NULL,
  "reportedAvailable" INTEGER NOT NULL,
  "expectedAvailable" INTEGER,
  "difference" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'UNMAPPED',
  "observedAt" TIMESTAMP(3) NOT NULL,
  "sourceEventId" TEXT NOT NULL,
  "source" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelInventoryReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelInventoryReconciliation_channelAccountId_externalSkuId_key"
ON "ChannelInventoryReconciliation"("channelAccountId", "externalSkuId");

CREATE INDEX "ChannelInventoryReconciliation_channelAccountId_status_updatedAt_idx"
ON "ChannelInventoryReconciliation"("channelAccountId", "status", "updatedAt");

ALTER TABLE "ChannelInventoryReconciliation"
ADD CONSTRAINT "ChannelInventoryReconciliation_channelAccountId_fkey"
FOREIGN KEY ("channelAccountId") REFERENCES "SalesChannelAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
