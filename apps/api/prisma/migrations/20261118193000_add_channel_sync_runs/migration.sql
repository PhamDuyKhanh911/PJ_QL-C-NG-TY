CREATE TYPE "ChannelSyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TABLE "ChannelSyncRun" (
    "id" TEXT NOT NULL, "channelAccountId" TEXT NOT NULL,
    "status" "ChannelSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "direction" TEXT NOT NULL DEFAULT 'PUSH_INVENTORY',
    "mappedSkuCount" INTEGER NOT NULL DEFAULT 0, "processedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0, "snapshot" JSONB, "errorMessage" TEXT,
    "triggeredById" TEXT, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3), CONSTRAINT "ChannelSyncRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChannelSyncRun_channelAccountId_startedAt_idx" ON "ChannelSyncRun"("channelAccountId", "startedAt");
ALTER TABLE "ChannelSyncRun" ADD CONSTRAINT "ChannelSyncRun_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "SalesChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
