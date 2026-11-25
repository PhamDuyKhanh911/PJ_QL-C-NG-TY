UPDATE "Role"
SET "permissions" = "permissions" || '["dashboard.read"]'::jsonb
WHERE "code" IN ('ONLINE_MANAGER', 'CATALOG_MANAGER', 'WAREHOUSE_STAFF', 'CUSTOMER_SERVICE', 'SALES_STAFF', 'REPORT_VIEWER', 'PURCHASING_STAFF')
  AND NOT ("permissions" ? 'dashboard.read');
