UPDATE "Role"
SET "permissions" = "permissions" || '["activity.read"]'::jsonb
WHERE "code" = 'REPORT_VIEWER'
  AND NOT ("permissions" ? 'activity.read');
