CREATE TYPE "InventoryStocktakeStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

CREATE TABLE "InventoryStocktake" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "InventoryStocktakeStatus" NOT NULL DEFAULT 'DRAFT',
  "note" TEXT,
  "createdById" TEXT NOT NULL,
  "completedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "InventoryStocktake_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryStocktakeItem" (
  "id" TEXT NOT NULL,
  "stocktakeId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "expectedQuantity" INTEGER NOT NULL,
  "countedQuantity" INTEGER,
  "note" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryStocktakeItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryStocktake_code_key" ON "InventoryStocktake"("code");
CREATE INDEX "InventoryStocktake_organizationId_status_createdAt_idx" ON "InventoryStocktake"("organizationId", "status", "createdAt");
CREATE INDEX "InventoryStocktake_warehouseId_status_idx" ON "InventoryStocktake"("warehouseId", "status");
CREATE UNIQUE INDEX "InventoryStocktakeItem_stocktakeId_variantId_key" ON "InventoryStocktakeItem"("stocktakeId", "variantId");
CREATE INDEX "InventoryStocktakeItem_variantId_idx" ON "InventoryStocktakeItem"("variantId");

ALTER TABLE "InventoryStocktake" ADD CONSTRAINT "InventoryStocktake_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryStocktake" ADD CONSTRAINT "InventoryStocktake_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryStocktakeItem" ADD CONSTRAINT "InventoryStocktakeItem_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "InventoryStocktake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryStocktakeItem" ADD CONSTRAINT "InventoryStocktakeItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "Role"
SET "permissions" = "permissions" || '["inventory.count"]'::jsonb
WHERE "code" = 'WAREHOUSE_STAFF'
  AND NOT ("permissions" ? 'inventory.count');
