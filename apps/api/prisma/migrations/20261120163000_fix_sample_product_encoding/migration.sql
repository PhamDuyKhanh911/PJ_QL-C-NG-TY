UPDATE "Product" p
SET "name" = U&'\00C1o thun Basic'
WHERE EXISTS (
  SELECT 1 FROM "ProductVariant" pv
  WHERE pv."productId" = p."id" AND pv."sku" IN ('AT-BASIC-DEN-M', 'AT-BASIC-TRANG-L')
);

DELETE FROM "Product" empty_product
WHERE empty_product."name" = U&'\00C1o thun Basic'
  AND NOT EXISTS (SELECT 1 FROM "ProductVariant" pv WHERE pv."productId" = empty_product."id")
  AND EXISTS (
    SELECT 1
    FROM "Product" populated_product
    JOIN "ProductVariant" pv ON pv."productId" = populated_product."id"
    WHERE populated_product."organizationId" = empty_product."organizationId"
      AND pv."sku" IN ('AT-BASIC-DEN-M', 'AT-BASIC-TRANG-L')
  );
