ALTER TABLE "SalesOrder"
  ADD COLUMN "responsibleUserId" TEXT,
  ADD COLUMN "responsibilityAssignedAt" TIMESTAMP(3);
ALTER TABLE "OrderFulfillmentEvent"
  ADD COLUMN "responsibleUserId" TEXT;
CREATE INDEX "SalesOrder_responsibleUserId_status_idx" ON "SalesOrder"("responsibleUserId", "status");
