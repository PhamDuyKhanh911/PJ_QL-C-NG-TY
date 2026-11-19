ALTER TABLE "ChannelConnection"
ADD COLUMN "defaultWarehouseId" TEXT,
ADD COLUMN "orderSyncCursorAt" TIMESTAMP(3),
ADD COLUMN "lastOrderSyncAt" TIMESTAMP(3),
ADD COLUMN "orderSyncStatus" TEXT NOT NULL DEFAULT 'IDLE',
ADD COLUMN "orderSyncLeaseUntil" TIMESTAMP(3),
ADD COLUMN "orderSyncError" TEXT;

ALTER TABLE "ChannelConnection"
ADD CONSTRAINT "ChannelConnection_defaultWarehouseId_fkey"
FOREIGN KEY ("defaultWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ChannelConnection_orderSyncStatus_orderSyncLeaseUntil_idx"
ON "ChannelConnection"("orderSyncStatus", "orderSyncLeaseUntil");
