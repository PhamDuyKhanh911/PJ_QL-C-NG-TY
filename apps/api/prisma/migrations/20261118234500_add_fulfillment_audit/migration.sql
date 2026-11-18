CREATE TABLE "OrderFulfillmentEvent" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromStatus" "OrderStatus" NOT NULL,
  "toStatus" "OrderStatus" NOT NULL,
  "performedById" TEXT NOT NULL,
  "carrierName" TEXT,
  "trackingCode" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderFulfillmentEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderFulfillmentEvent_orderId_createdAt_idx" ON "OrderFulfillmentEvent"("orderId", "createdAt");
CREATE INDEX "OrderFulfillmentEvent_performedById_createdAt_idx" ON "OrderFulfillmentEvent"("performedById", "createdAt");
ALTER TABLE "OrderFulfillmentEvent" ADD CONSTRAINT "OrderFulfillmentEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
