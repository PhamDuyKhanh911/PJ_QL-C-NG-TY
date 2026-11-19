CREATE TYPE "ChannelWebhookEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

CREATE TABLE "ChannelWebhookEvent" (
  "id" TEXT NOT NULL,
  "channelAccountId" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "ChannelWebhookEventStatus" NOT NULL DEFAULT 'PENDING',
  "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "errorMessage" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelWebhookEvent_channelAccountId_providerEventId_key" ON "ChannelWebhookEvent"("channelAccountId", "providerEventId");
CREATE INDEX "ChannelWebhookEvent_status_nextAttemptAt_idx" ON "ChannelWebhookEvent"("status", "nextAttemptAt");
CREATE INDEX "ChannelWebhookEvent_channelAccountId_receivedAt_idx" ON "ChannelWebhookEvent"("channelAccountId", "receivedAt");
ALTER TABLE "ChannelWebhookEvent" ADD CONSTRAINT "ChannelWebhookEvent_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "SalesChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
