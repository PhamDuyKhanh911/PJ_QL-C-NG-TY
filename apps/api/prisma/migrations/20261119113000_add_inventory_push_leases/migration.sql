ALTER TABLE "ChannelSyncRun"
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "leaseUntil" TIMESTAMP(3);

CREATE INDEX "ChannelSyncRun_status_nextAttemptAt_leaseUntil_idx"
ON "ChannelSyncRun"("status", "nextAttemptAt", "leaseUntil");

-- Các snapshot cũ chỉ được đánh dấu hoàn tất nội bộ và thiếu externalProductId,
-- vì vậy không được phép gửi lại sau khi worker API thật được bật.
UPDATE "ChannelSyncRun"
SET "status" = 'FAILED',
    "failedCount" = "mappedSkuCount",
    "errorMessage" = 'Snapshot cũ chưa từng được sàn xác nhận; hãy tạo lượt đồng bộ mới',
    "completedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'RUNNING' AND "direction" <> 'PULL_ORDERS';
