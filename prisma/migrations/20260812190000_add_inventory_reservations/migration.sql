ALTER TABLE "inventory"
ADD COLUMN "reserved_quantity" INTEGER NOT NULL DEFAULT 0;

-- Preserve stock already promised by orders created before this migration.
-- If legacy open orders exceed physical stock, the constraint below deliberately
-- stops the migration so the inconsistency can be reconciled instead of hidden.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "orders" o
    JOIN "order_items" oi ON oi."order_id" = o."id"
    LEFT JOIN "inventory" i
      ON i."owner_id" = o."seller_id" AND i."product_id" = oi."product_id"
    WHERE o."status" IN ('pending', 'processing', 'ready_for_pickup')
    GROUP BY o."seller_id", oi."product_id", i."quantity"
    HAVING i."quantity" IS NULL OR SUM(oi."quantity") > i."quantity"
  ) THEN
    RAISE EXCEPTION 'Open orders exceed available physical inventory; reconcile them before enabling reservations.';
  END IF;
END $$;

WITH open_order_stock AS (
  SELECT o."seller_id", oi."product_id", SUM(oi."quantity")::INTEGER AS quantity
  FROM "orders" o
  JOIN "order_items" oi ON oi."order_id" = o."id"
  WHERE o."status" IN ('pending', 'processing', 'ready_for_pickup')
  GROUP BY o."seller_id", oi."product_id"
)
UPDATE "inventory" i
SET "reserved_quantity" = open_order_stock.quantity
FROM open_order_stock
WHERE i."owner_id" = open_order_stock."seller_id"
  AND i."product_id" = open_order_stock."product_id";

ALTER TABLE "inventory"
ADD CONSTRAINT "inventory_non_negative_stock_check"
CHECK ("quantity" >= 0 AND "reserved_quantity" >= 0 AND "reserved_quantity" <= "quantity");
