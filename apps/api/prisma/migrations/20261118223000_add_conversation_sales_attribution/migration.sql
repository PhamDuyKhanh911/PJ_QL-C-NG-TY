ALTER TABLE "Conversation" ADD COLUMN "closedOrderId" TEXT, ADD COLUMN "closedByUserId" TEXT, ADD COLUMN "closedAt" TIMESTAMP(3);
CREATE INDEX "Conversation_closedByUserId_closedAt_idx" ON "Conversation"("closedByUserId", "closedAt");
