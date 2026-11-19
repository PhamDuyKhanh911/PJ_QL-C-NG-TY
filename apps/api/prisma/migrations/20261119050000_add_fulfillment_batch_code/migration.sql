ALTER TABLE "OrderFulfillmentEvent"
  ADD COLUMN "batchCode" TEXT;

CREATE INDEX "OrderFulfillmentEvent_batchCode_idx" ON "OrderFulfillmentEvent"("batchCode");
