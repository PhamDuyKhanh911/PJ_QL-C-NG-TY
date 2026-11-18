CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'MATCHED', 'MISMATCH');
CREATE TABLE "OrderSettlement" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "channelAccountId" TEXT NOT NULL,
  "externalSettlementId" TEXT,
  "grossAmount" DECIMAL(18,2) NOT NULL,
  "platformFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "shippingFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "refundAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "otherFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "expectedNetAmount" DECIMAL(18,2) NOT NULL,
  "paidAmount" DECIMAL(18,2) NOT NULL,
  "differenceAmount" DECIMAL(18,2) NOT NULL,
  "status" "ReconciliationStatus" NOT NULL,
  "settledAt" TIMESTAMP(3),
  "syncedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderSettlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderSettlement_orderId_key" ON "OrderSettlement"("orderId");
CREATE UNIQUE INDEX "OrderSettlement_channelAccountId_externalSettlementId_key" ON "OrderSettlement"("channelAccountId", "externalSettlementId");
CREATE INDEX "OrderSettlement_channelAccountId_status_settledAt_idx" ON "OrderSettlement"("channelAccountId", "status", "settledAt");
ALTER TABLE "OrderSettlement" ADD CONSTRAINT "OrderSettlement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderSettlement" ADD CONSTRAINT "OrderSettlement_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "SalesChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
