ALTER TABLE "orders"
ADD COLUMN "delivered_at" TIMESTAMP(3),
ADD COLUMN "paid_at" TIMESTAMP(3);

ALTER TABLE "order_items"
ADD COLUMN "unit_acquisition_cost" DECIMAL(10,2);

ALTER TABLE "registration_financials"
ADD COLUMN "payment_status" VARCHAR NOT NULL DEFAULT 'paid',
ADD COLUMN "paid_at" TIMESTAMP(3);

-- Existing rows did not preserve the exact transition timestamps. updated_at is
-- the closest available historical evidence; all new writes use exact timestamps.
UPDATE "orders"
SET "delivered_at" = "updated_at"
WHERE "status" = 'delivered' AND "delivered_at" IS NULL;

UPDATE "orders"
SET "paid_at" = "updated_at"
WHERE "payment_status" = 'paid' AND "paid_at" IS NULL;

UPDATE "registration_financials"
SET "paid_at" = "created_at"
WHERE "payment_status" = 'paid' AND "paid_at" IS NULL;

-- Freeze the best available acquisition price for legacy City/Branch sales.
UPDATE "order_items" AS oi
SET "unit_acquisition_cost" = CASE
  WHEN dp."dist_level" = 'branch'
    THEN COALESCE(NULLIF(p."branch_price", 0), p."cost_price")
  ELSE COALESCE(NULLIF(p."city_price", 0), p."cost_price")
END
FROM "orders" AS o
JOIN "users" AS u ON u."id" = o."seller_id"
LEFT JOIN "distributor_profiles" AS dp ON dp."user_id" = u."id"
JOIN "products" AS p ON TRUE
WHERE oi."order_id" = o."id"
  AND p."id" = oi."product_id"
  AND u."role" = 'city'
  AND oi."unit_acquisition_cost" IS NULL;

CREATE INDEX "orders_seller_id_delivered_at_idx"
ON "orders"("seller_id", "delivered_at");

CREATE INDEX "orders_seller_id_paid_at_idx"
ON "orders"("seller_id", "paid_at");

CREATE INDEX "registration_financials_city_dist_id_paid_at_idx"
ON "registration_financials"("city_dist_id", "paid_at");
