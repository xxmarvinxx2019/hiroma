CREATE TABLE IF NOT EXISTS "inventory_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "admin_id" UUID NOT NULL,
  "recipient_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "order_id" UUID,
  "quantity" INTEGER NOT NULL,
  "unit_cost" DECIMAL(10,2) NOT NULL,
  "unit_price" DECIMAL(10,2) NOT NULL,
  "reference_value" DECIMAL(12,2) NOT NULL,
  "sale_value" DECIMAL(12,2) NOT NULL,
  "admin_profit" DECIMAL(12,2) NOT NULL,
  "is_sale" BOOLEAN NOT NULL DEFAULT true,
  "admin_stock_before" INTEGER NOT NULL,
  "admin_stock_after" INTEGER NOT NULL,
  "recipient_stock_before" INTEGER NOT NULL,
  "recipient_stock_after" INTEGER NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inventory_movements_recipient_id_product_id_created_at_idx"
  ON "inventory_movements"("recipient_id", "product_id", "created_at");

CREATE INDEX IF NOT EXISTS "inventory_movements_admin_id_created_at_idx"
  ON "inventory_movements"("admin_id", "created_at");
