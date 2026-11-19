ALTER TABLE "Message"
  ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextDeliveryAttemptAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "lastDeliveryError" TEXT;

UPDATE "Message"
SET "deliveryStatus" = 'LEGACY_NOT_SENT',
    "lastDeliveryError" = 'Tin nhắn được tạo trước khi bật connector gửi ra kênh; không tự động gửi lại để tránh trùng'
WHERE "direction" = 'OUTBOUND';

CREATE INDEX "Message_direction_deliveryStatus_nextDeliveryAttemptAt_idx"
  ON "Message"("direction", "deliveryStatus", "nextDeliveryAttemptAt");
