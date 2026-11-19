ALTER TABLE "ChannelConnection"
  ADD COLUMN "accessTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "refreshTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastTokenRefreshAt" TIMESTAMP(3),
  ADD COLUMN "tokenRefreshStatus" TEXT NOT NULL DEFAULT 'IDLE',
  ADD COLUMN "tokenRefreshLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "grantedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "ChannelConnection_tokenRefreshStatus_accessTokenExpiresAt_idx"
  ON "ChannelConnection"("tokenRefreshStatus", "accessTokenExpiresAt");
