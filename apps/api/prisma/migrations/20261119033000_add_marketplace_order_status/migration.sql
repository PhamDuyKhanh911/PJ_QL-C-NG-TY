ALTER TABLE "SalesOrder"
  ADD COLUMN "externalStatus" TEXT,
  ADD COLUMN "externalStatusUpdatedAt" TIMESTAMP(3);

CREATE INDEX "SalesOrder_channelAccountId_externalStatus_idx" ON "SalesOrder"("channelAccountId", "externalStatus");
