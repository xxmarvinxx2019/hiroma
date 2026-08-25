ALTER TABLE "orders"
  ADD COLUMN "fulfillment_method" VARCHAR NOT NULL DEFAULT 'partner_pickup',
  ADD COLUMN "shipping_status" VARCHAR,
  ADD COLUMN "shipping_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "courier_name" VARCHAR,
  ADD COLUMN "courier_service" VARCHAR,
  ADD COLUMN "courier_quote_reference" VARCHAR;

CREATE INDEX "orders_fulfillment_method_status_idx"
  ON "orders" ("fulfillment_method", "status");
