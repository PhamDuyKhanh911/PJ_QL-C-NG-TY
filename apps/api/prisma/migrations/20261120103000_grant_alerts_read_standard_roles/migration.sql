UPDATE "Role"
SET "permissions" = "permissions" || '["alerts.read"]'::jsonb
WHERE "code" IN ('ONLINE_MANAGER', 'WAREHOUSE_STAFF', 'REPORT_VIEWER')
  AND NOT ("permissions" ? 'alerts.read');
