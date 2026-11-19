CREATE TYPE "ChannelConnectionStatus" AS ENUM ('INCOMPLETE', 'READY', 'ERROR');

CREATE TABLE "ChannelConnection" (
  "id" TEXT NOT NULL,
  "channelAccountId" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'PRODUCTION',
  "clientId" TEXT,
  "accountIdentifier" TEXT,
  "apiBaseUrl" TEXT,
  "clientSecretEncrypted" TEXT,
  "accessTokenEncrypted" TEXT,
  "refreshTokenEncrypted" TEXT,
  "webhookSecretEncrypted" TEXT,
  "status" "ChannelConnectionStatus" NOT NULL DEFAULT 'INCOMPLETE',
  "orderSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
  "inventorySyncEnabled" BOOLEAN NOT NULL DEFAULT true,
  "chatSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
  "lastCheckedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelConnection_channelAccountId_key" ON "ChannelConnection"("channelAccountId");
CREATE INDEX "ChannelConnection_status_updatedAt_idx" ON "ChannelConnection"("status", "updatedAt");
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "SalesChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
