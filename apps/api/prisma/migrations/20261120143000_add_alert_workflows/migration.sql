CREATE TABLE "AlertWorkflow" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "alertKey" TEXT NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "assignedUserId" TEXT,
  "resolutionNote" TEXT,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AlertWorkflow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlertWorkflow_organizationId_alertKey_key" ON "AlertWorkflow"("organizationId", "alertKey");
CREATE INDEX "AlertWorkflow_organizationId_status_updatedAt_idx" ON "AlertWorkflow"("organizationId", "status", "updatedAt");
CREATE INDEX "AlertWorkflow_assignedUserId_status_idx" ON "AlertWorkflow"("assignedUserId", "status");

UPDATE "Role"
SET "permissions" = "permissions" || '["alerts.manage"]'::jsonb
WHERE "code" IN ('ONLINE_MANAGER', 'WAREHOUSE_STAFF')
  AND NOT ("permissions" ? 'alerts.manage');
