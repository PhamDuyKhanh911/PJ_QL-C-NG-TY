ALTER TABLE "ChannelConnection"
  ADD COLUMN "authorizationIdentifier" TEXT;

CREATE TABLE "ChannelOAuthSession" (
  "id" TEXT NOT NULL,
  "channelAccountId" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "provider" "ChannelType" NOT NULL,
  "callbackUrl" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelOAuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelOAuthSession_stateHash_key" ON "ChannelOAuthSession"("stateHash");
CREATE INDEX "ChannelOAuthSession_channelAccountId_status_expiresAt_idx" ON "ChannelOAuthSession"("channelAccountId", "status", "expiresAt");
ALTER TABLE "ChannelOAuthSession" ADD CONSTRAINT "ChannelOAuthSession_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "SalesChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
