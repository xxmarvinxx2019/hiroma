BEGIN;

-- Freeze every source and sink touched by the conversion until legacy rows are
-- classified and all replacement guards are installed.
LOCK TABLE "commissions", "inventory_movements", "order_items", "orders",
  "product_binary_funding_consumptions", "product_binary_funding_lots",
  "product_binary_order_events", "product_binary_settlement_jobs", "products",
  "users"
  IN SHARE ROW EXCLUSIVE MODE;

-- Migration 1400 correctly blocks direct lot writes. Temporarily remove that
-- one trigger under the lock so this migration can quarantine/backfill; it is
-- restored before COMMIT. Application traffic cannot enter between the two.
DROP TRIGGER IF EXISTS "product_binary_funding_lots_protected_write" ON "product_binary_funding_lots";
DROP TRIGGER IF EXISTS "orders_enqueue_product_binary_settlement" ON "orders";
DROP FUNCTION IF EXISTS "enqueue_product_binary_settlement"();
ALTER TABLE "product_binary_settlement_jobs"
  DROP CONSTRAINT IF EXISTS "product_binary_settlement_jobs_status_check";

-- Product Binary now trusts only database-authored snapshots attached to a
-- paid, delivered commerce order. Mutable inventory movements are retained as
-- logistics evidence, but can no longer mint commission reserve.
DROP TRIGGER IF EXISTS "inventory_movement_create_product_binary_funding" ON "inventory_movements";
DROP FUNCTION IF EXISTS "create_product_binary_funding_lot"();

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "binary_eligible_snapshot" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "pu_value_snapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "company_unit_cost_snapshot" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "company_unit_margin_snapshot" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "snapshot_source" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "snapshotted_at" TIMESTAMPTZ(6);

ALTER TABLE "product_binary_settlement_jobs"
  ALTER COLUMN "status" TYPE VARCHAR(48),
  ADD COLUMN IF NOT EXISTS "qualification_status" VARCHAR(48) NOT NULL DEFAULT 'awaiting_qualification',
  ADD COLUMN IF NOT EXISTS "buyer_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_status_snapshot" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "paid_at_snapshot" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "delivered_at_snapshot" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "eligible_units_snapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "total_pu_snapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "gross_margin_snapshot" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "snapshot_version" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "qualified_at" TIMESTAMPTZ(6);
ALTER TABLE "product_binary_settlement_jobs"
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "product_binary_order_events"
  ADD COLUMN IF NOT EXISTS "settlement_job_id" UUID,
  ADD COLUMN IF NOT EXISTS "payment_status_snapshot" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "paid_at_snapshot" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "delivered_at_snapshot" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "snapshot_version" VARCHAR(40);

CREATE UNIQUE INDEX IF NOT EXISTS "product_binary_order_events_settlement_job_id_key"
  ON "product_binary_order_events"("settlement_job_id");

ALTER TABLE "product_binary_order_events"
  DROP CONSTRAINT IF EXISTS "product_binary_order_events_order_id_fkey",
  ADD CONSTRAINT "product_binary_order_events_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT NOT VALID,
  DROP CONSTRAINT IF EXISTS "product_binary_order_events_settlement_job_id_fkey",
  ADD CONSTRAINT "product_binary_order_events_settlement_job_id_fkey"
    FOREIGN KEY ("settlement_job_id") REFERENCES "product_binary_settlement_jobs"("id")
    ON DELETE RESTRICT NOT VALID;
ALTER TABLE "product_binary_order_events"
  VALIDATE CONSTRAINT "product_binary_order_events_order_id_fkey";
ALTER TABLE "product_binary_order_events"
  VALIDATE CONSTRAINT "product_binary_order_events_settlement_job_id_fkey";

ALTER TABLE "product_binary_settlement_jobs"
  DROP CONSTRAINT IF EXISTS "product_binary_settlement_jobs_order_id_fkey",
  ADD CONSTRAINT "product_binary_settlement_jobs_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT NOT VALID;
ALTER TABLE "product_binary_settlement_jobs"
  VALIDATE CONSTRAINT "product_binary_settlement_jobs_order_id_fkey";

ALTER TABLE "product_binary_funding_lots"
  ADD COLUMN IF NOT EXISTS "order_id" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_status_snapshot" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "paid_at_snapshot" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "delivered_at_snapshot" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "eligible_units_snapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "total_pu_snapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "gross_margin_snapshot" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "snapshot_version" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "reconciliation_status" VARCHAR(40) NOT NULL DEFAULT 'exact';

CREATE UNIQUE INDEX IF NOT EXISTS "product_binary_funding_lots_order_id_key"
  ON "product_binary_funding_lots"("order_id");

ALTER TABLE "product_binary_funding_lots"
  DROP CONSTRAINT IF EXISTS "product_binary_funding_lots_order_id_fkey",
  ADD CONSTRAINT "product_binary_funding_lots_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT NOT VALID;
ALTER TABLE "product_binary_funding_lots"
  VALIDATE CONSTRAINT "product_binary_funding_lots_order_id_fkey";

-- Existing movement-based reserve cannot be proven from immutable paid-order
-- evidence. Preserve its original amount for audit, quarantine only its unused
-- balance, and require an operator reconciliation rather than invent history.
UPDATE "product_binary_funding_lots"
SET "remaining_amount" = 0,
    "reconciliation_status" = 'legacy_movement_quarantined',
    "snapshot_source" = 'legacy_movement_quarantined'
WHERE "order_id" IS NULL
  AND "remaining_amount" > 0;

UPDATE "product_binary_settlement_jobs"
SET "qualification_status" = CASE
      WHEN "status" = 'completed' THEN 'legacy_completed'
      ELSE 'legacy_snapshot_reconciliation'
    END,
    "status" = CASE
      WHEN "status" = 'completed' THEN 'completed'
      ELSE 'reconciliation_required'
    END,
    "last_error" = CASE
      WHEN "status" = 'completed' THEN "last_error"
      ELSE 'Legacy order items have no database-authored Product Binary snapshot.'
    END
WHERE "snapshot_version" IS NULL;

CREATE OR REPLACE FUNCTION "snapshot_product_binary_order_item"()
RETURNS TRIGGER AS $$
DECLARE
  product_row RECORD;
BEGIN
  SELECT product."binary_eligible", product."pu_value", product."cost_price"
  INTO product_row
  FROM "products" product
  WHERE product."id" = NEW."product_id"
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order item product does not exist.' USING ERRCODE = '23503';
  END IF;
  IF NEW."quantity" <= 0 OR NEW."unit_price" < 0
     OR NEW."subtotal" IS DISTINCT FROM ROUND(NEW."unit_price" * NEW."quantity", 2) THEN
    RAISE EXCEPTION 'Order item quantity, price, and subtotal are inconsistent.' USING ERRCODE = '23514';
  END IF;

  NEW."binary_eligible_snapshot" := COALESCE(product_row."binary_eligible", false);
  NEW."pu_value_snapshot" := GREATEST(0, COALESCE(product_row."pu_value", 0));
  NEW."company_unit_cost_snapshot" := product_row."cost_price";
  NEW."company_unit_margin_snapshot" := GREATEST(0, NEW."unit_price" - product_row."cost_price");
  NEW."snapshot_source" := 'product-binary-order-v1';
  NEW."snapshotted_at" := transaction_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "order_items_snapshot_product_binary" ON "order_items";
CREATE TRIGGER "order_items_snapshot_product_binary"
BEFORE INSERT ON "order_items"
FOR EACH ROW EXECUTE FUNCTION "snapshot_product_binary_order_item"();

-- Paid/delivered evidence is also database-authored. This normalizes routes
-- that update the status flags but omit their timestamps and rejects a caller's
-- attempt to predate or future-date the financial qualification boundary.
CREATE OR REPLACE FUNCTION "stamp_product_binary_order_times"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."payment_status" = 'paid'
     AND (TG_OP = 'INSERT' OR OLD."payment_status" IS DISTINCT FROM 'paid') THEN
    NEW."paid_at" := transaction_timestamp();
  END IF;
  IF NEW."status"::text = 'delivered'
     AND (TG_OP = 'INSERT' OR OLD."status"::text IS DISTINCT FROM 'delivered') THEN
    NEW."delivered_at" := transaction_timestamp();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "orders_stamp_product_binary_times" ON "orders";
CREATE TRIGGER "orders_stamp_product_binary_times"
BEFORE INSERT OR UPDATE ON "orders"
FOR EACH ROW EXECUTE FUNCTION "stamp_product_binary_order_times"();

CREATE OR REPLACE FUNCTION "seal_product_binary_order_item"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Order-item financial identity is immutable; cancel and recreate the order.' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW."order_id", NEW."product_id", NEW."quantity", NEW."unit_price",
         NEW."unit_acquisition_cost", NEW."subtotal", NEW."binary_eligible_snapshot",
         NEW."pu_value_snapshot", NEW."company_unit_cost_snapshot",
         NEW."company_unit_margin_snapshot", NEW."snapshot_source", NEW."snapshotted_at")
     IS DISTINCT FROM
     ROW(OLD."order_id", OLD."product_id", OLD."quantity", OLD."unit_price",
         OLD."unit_acquisition_cost", OLD."subtotal", OLD."binary_eligible_snapshot",
         OLD."pu_value_snapshot", OLD."company_unit_cost_snapshot",
         OLD."company_unit_margin_snapshot", OLD."snapshot_source", OLD."snapshotted_at") THEN
    RAISE EXCEPTION 'Order-item financial identity is immutable; cancel and recreate the order.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "order_items_seal_product_binary" ON "order_items";
CREATE TRIGGER "order_items_seal_product_binary"
BEFORE UPDATE OR DELETE ON "order_items"
FOR EACH ROW EXECUTE FUNCTION "seal_product_binary_order_item"();

CREATE OR REPLACE FUNCTION "seal_inventory_movement_financial_identity"()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(NEW."transfer_id", NEW."admin_id", NEW."recipient_id", NEW."product_id", NEW."order_id",
         NEW."quantity", NEW."unit_cost", NEW."unit_price", NEW."reference_value", NEW."sale_value",
         NEW."admin_profit", NEW."is_sale", NEW."admin_stock_before", NEW."admin_stock_after",
         NEW."recipient_stock_before", NEW."recipient_stock_after", NEW."created_at")
     IS DISTINCT FROM
     ROW(OLD."transfer_id", OLD."admin_id", OLD."recipient_id", OLD."product_id", OLD."order_id",
         OLD."quantity", OLD."unit_cost", OLD."unit_price", OLD."reference_value", OLD."sale_value",
         OLD."admin_profit", OLD."is_sale", OLD."admin_stock_before", OLD."admin_stock_after",
         OLD."recipient_stock_before", OLD."recipient_stock_after", OLD."created_at") THEN
    RAISE EXCEPTION 'Inventory-movement financial identity is immutable.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_movements_seal_financial_identity" ON "inventory_movements";
CREATE TRIGGER "inventory_movements_seal_financial_identity"
BEFORE UPDATE ON "inventory_movements"
FOR EACH ROW EXECUTE FUNCTION "seal_inventory_movement_financial_identity"();

CREATE OR REPLACE FUNCTION "qualify_product_binary_order"(target_order_id TEXT)
RETURNS VOID AS $$
DECLARE
  source_order RECORD;
  item_count INTEGER;
  exact_item_count INTEGER;
  eligible_units INTEGER;
  total_pu INTEGER;
  order_gross_margin DECIMAL(12,2);
  company_gross_margin DECIMAL(12,2);
  funding_amount DECIMAL(12,2);
  target_status TEXT;
  target_qualification TEXT;
  target_error TEXT;
BEGIN
  SELECT orders."id", orders."buyer_id", orders."seller_id", buyer."role"::text AS buyer_role,
         seller."role"::text AS seller_role, orders."status"::text AS order_status,
         orders."payment_status", orders."financial_purpose", orders."paid_at", orders."delivered_at"
  INTO source_order
  FROM "orders" orders
  JOIN "users" buyer ON buyer."id" = orders."buyer_id"
  JOIN "users" seller ON seller."id" = orders."seller_id"
  WHERE orders."id" = target_order_id
  FOR SHARE OF orders, buyer, seller;

  IF NOT FOUND OR source_order.order_status <> 'delivered'
     OR source_order.financial_purpose <> 'commerce' THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::INTEGER,
         COUNT(*) FILTER (
           WHERE item."snapshot_source" = 'product-binary-order-v1'
             AND item."binary_eligible_snapshot" IS NOT NULL
             AND item."pu_value_snapshot" IS NOT NULL
             AND item."company_unit_cost_snapshot" IS NOT NULL
             AND item."company_unit_margin_snapshot" IS NOT NULL
             AND item."snapshotted_at" IS NOT NULL
         )::INTEGER,
         COALESCE(SUM(CASE WHEN item."binary_eligible_snapshot" AND item."pu_value_snapshot" > 0
                           THEN item."quantity" ELSE 0 END), 0)::INTEGER,
         COALESCE(SUM(CASE WHEN item."binary_eligible_snapshot" AND item."pu_value_snapshot" > 0
                           THEN item."quantity" * item."pu_value_snapshot" ELSE 0 END), 0)::INTEGER,
         COALESCE(SUM(CASE WHEN item."binary_eligible_snapshot" AND item."pu_value_snapshot" > 0
                           THEN item."quantity" * GREATEST(0, item."unit_price" - COALESCE(item."unit_acquisition_cost", item."company_unit_cost_snapshot"))
                           ELSE 0 END), 0)::DECIMAL(12,2),
         COALESCE(SUM(CASE WHEN item."binary_eligible_snapshot" AND item."pu_value_snapshot" > 0
                           THEN item."quantity" * item."company_unit_margin_snapshot" ELSE 0 END), 0)::DECIMAL(12,2)
  INTO item_count, exact_item_count, eligible_units, total_pu, order_gross_margin, company_gross_margin
  FROM "order_items" item
  WHERE item."order_id" = target_order_id;

  IF source_order.buyer_role = 'reseller' THEN
    IF source_order.payment_status IS DISTINCT FROM 'paid' OR source_order.paid_at IS NULL THEN
      target_status := 'waiting_payment';
      target_qualification := 'waiting_for_paid_delivery';
      target_error := 'Product Binary waits for seller-confirmed payment.';
    ELSIF item_count = 0 OR exact_item_count <> item_count THEN
      target_status := 'reconciliation_required';
      target_qualification := 'legacy_snapshot_reconciliation';
      target_error := 'Paid delivered legacy order has no complete database-authored Product Binary item snapshot.';
    ELSIF total_pu <= 0 THEN
      target_status := 'completed';
      target_qualification := 'ineligible_zero_pu';
      target_error := NULL;
    ELSE
      target_status := 'pending';
      target_qualification := 'qualified_paid_delivery';
      target_error := NULL;
    END IF;

    INSERT INTO "product_binary_settlement_jobs" (
      "id", "order_id", "status", "qualification_status", "buyer_user_id",
      "payment_status_snapshot", "paid_at_snapshot", "delivered_at_snapshot",
      "eligible_units_snapshot", "total_pu_snapshot", "gross_margin_snapshot",
      "snapshot_version", "qualified_at", "last_error", "completed_at", "next_attempt_at", "updated_at"
    ) VALUES (
      gen_random_uuid(), target_order_id, target_status, target_qualification, source_order.buyer_id,
      source_order.payment_status, source_order.paid_at, source_order.delivered_at,
      CASE WHEN source_order.payment_status = 'paid' AND exact_item_count = item_count AND item_count > 0 THEN eligible_units ELSE NULL END,
      CASE WHEN source_order.payment_status = 'paid' AND exact_item_count = item_count AND item_count > 0 THEN total_pu ELSE NULL END,
      CASE WHEN source_order.payment_status = 'paid' AND exact_item_count = item_count AND item_count > 0 THEN order_gross_margin ELSE NULL END,
      CASE WHEN source_order.payment_status = 'paid' AND exact_item_count = item_count AND item_count > 0 THEN 'product-binary-order-v1' ELSE NULL END,
      CASE WHEN source_order.payment_status = 'paid' THEN transaction_timestamp() ELSE NULL END,
      target_error,
      CASE WHEN target_status = 'completed' THEN transaction_timestamp() ELSE NULL END,
      transaction_timestamp(), transaction_timestamp()
    )
    ON CONFLICT ("order_id") DO UPDATE SET
      "status" = EXCLUDED."status",
      "qualification_status" = EXCLUDED."qualification_status",
      "buyer_user_id" = EXCLUDED."buyer_user_id",
      "payment_status_snapshot" = EXCLUDED."payment_status_snapshot",
      "paid_at_snapshot" = EXCLUDED."paid_at_snapshot",
      "delivered_at_snapshot" = EXCLUDED."delivered_at_snapshot",
      "eligible_units_snapshot" = EXCLUDED."eligible_units_snapshot",
      "total_pu_snapshot" = EXCLUDED."total_pu_snapshot",
      "gross_margin_snapshot" = EXCLUDED."gross_margin_snapshot",
      "snapshot_version" = EXCLUDED."snapshot_version",
      "qualified_at" = EXCLUDED."qualified_at",
      "last_error" = EXCLUDED."last_error",
      "completed_at" = EXCLUDED."completed_at",
      "next_attempt_at" = EXCLUDED."next_attempt_at",
      "updated_at" = transaction_timestamp()
    WHERE "product_binary_settlement_jobs"."status" <> 'completed';
  END IF;

  -- Only realized Hiroma/Admin commerce margin creates reserve. Distributor
  -- resale orders can create PU obligations, but never fabricate company funds.
  IF source_order.seller_role = 'admin'
     AND source_order.payment_status = 'paid'
     AND source_order.paid_at IS NOT NULL THEN
    IF item_count = 0 OR exact_item_count <> item_count THEN
      INSERT INTO "product_binary_funding_lots" (
        "id", "order_id", "original_amount", "remaining_amount", "snapshot_source",
        "payment_status_snapshot", "paid_at_snapshot", "delivered_at_snapshot",
        "snapshot_version", "reconciliation_status", "allocated_at"
      ) VALUES (
        gen_random_uuid(), target_order_id, 0, 0, 'legacy_order_reconciliation_required',
        'paid', source_order.paid_at, source_order.delivered_at,
        NULL, 'legacy_snapshot_reconciliation', GREATEST(source_order.paid_at, source_order.delivered_at)
      ) ON CONFLICT ("order_id") DO NOTHING;
    ELSE
      funding_amount := LEAST(GREATEST(0, company_gross_margin), eligible_units * 20.00);
      INSERT INTO "product_binary_funding_lots" (
        "id", "order_id", "original_amount", "remaining_amount", "snapshot_source",
        "payment_status_snapshot", "paid_at_snapshot", "delivered_at_snapshot",
        "eligible_units_snapshot", "total_pu_snapshot", "gross_margin_snapshot",
        "snapshot_version", "reconciliation_status", "allocated_at"
      ) VALUES (
        gen_random_uuid(), target_order_id, funding_amount, funding_amount, 'paid-delivered-admin-order',
        'paid', source_order.paid_at, source_order.delivered_at,
        eligible_units, total_pu, company_gross_margin,
        'product-binary-order-v1', 'exact', GREATEST(source_order.paid_at, source_order.delivered_at)
      ) ON CONFLICT ("order_id") DO NOTHING;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "qualify_product_binary_order_trigger"()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM "qualify_product_binary_order"(NEW."id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "orders_qualify_product_binary" ON "orders";
CREATE CONSTRAINT TRIGGER "orders_qualify_product_binary"
AFTER INSERT OR UPDATE ON "orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "qualify_product_binary_order_trigger"();

-- Surface historical delivered orders without fabricating today's product PU,
-- costs, or eligibility as yesterday's facts.
INSERT INTO "product_binary_settlement_jobs" (
  "id", "order_id", "status", "qualification_status", "buyer_user_id", "payment_status_snapshot",
  "paid_at_snapshot", "delivered_at_snapshot", "last_error", "next_attempt_at", "updated_at"
)
SELECT gen_random_uuid(), orders."id", CASE WHEN orders."payment_status" = 'paid' THEN 'reconciliation_required' ELSE 'waiting_payment' END,
       CASE WHEN orders."payment_status" = 'paid' THEN 'legacy_snapshot_reconciliation' ELSE 'waiting_for_paid_delivery' END,
       orders."buyer_id", orders."payment_status", orders."paid_at", orders."delivered_at",
       CASE WHEN orders."payment_status" = 'paid'
            THEN 'Legacy delivered order has no database-authored Product Binary snapshot.'
            ELSE 'Product Binary waits for seller-confirmed payment.' END,
       transaction_timestamp(), transaction_timestamp()
FROM "orders" orders
JOIN "users" buyer ON buyer."id" = orders."buyer_id" AND buyer."role" = 'reseller'::"Role"
WHERE orders."status" = 'delivered'::"OrderStatus"
  AND orders."financial_purpose" = 'commerce'
ON CONFLICT ("order_id") DO NOTHING;

INSERT INTO "product_binary_funding_lots" (
  "id", "order_id", "original_amount", "remaining_amount", "snapshot_source",
  "payment_status_snapshot", "paid_at_snapshot", "delivered_at_snapshot",
  "snapshot_version", "reconciliation_status", "allocated_at"
)
SELECT gen_random_uuid(), orders."id", 0, 0, 'legacy_order_reconciliation_required',
       orders."payment_status", orders."paid_at", orders."delivered_at",
       NULL, 'legacy_snapshot_reconciliation',
       COALESCE(GREATEST(orders."paid_at", orders."delivered_at"), orders."created_at")
FROM "orders" orders
JOIN "users" seller ON seller."id" = orders."seller_id" AND seller."role" = 'admin'::"Role"
WHERE orders."status" = 'delivered'::"OrderStatus"
  AND orders."payment_status" = 'paid'
  AND orders."financial_purpose" = 'commerce'
ON CONFLICT ("order_id") DO NOTHING;

-- A source order is financially sealed as soon as it is paid/delivered or has
-- any Product Binary lineage. Status may progress to paid/delivered, but cannot
-- regress or rewrite who/what was sold after qualification.
CREATE OR REPLACE FUNCTION "seal_product_binary_order_identity"()
RETURNS TRIGGER AS $$
DECLARE
  has_lineage BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM "product_binary_settlement_jobs" job WHERE job."order_id" = OLD."id"
    UNION ALL SELECT 1 FROM "product_binary_funding_lots" lot WHERE lot."order_id" = OLD."id"
    UNION ALL SELECT 1 FROM "product_binary_order_events" event WHERE event."order_id" = OLD."id"
  ) INTO has_lineage;

  IF (OLD."status"::text = 'delivered' OR OLD."payment_status" = 'paid' OR has_lineage)
     AND ROW(NEW."buyer_id", NEW."seller_id", NEW."order_type", NEW."total_amount",
             NEW."financial_purpose", NEW."is_non_member_sale")
         IS DISTINCT FROM
         ROW(OLD."buyer_id", OLD."seller_id", OLD."order_type", OLD."total_amount",
             OLD."financial_purpose", OLD."is_non_member_sale") THEN
    RAISE EXCEPTION 'Qualified order financial identity is immutable.' USING ERRCODE = '23514';
  END IF;
  IF OLD."payment_status" = 'paid' AND NEW."payment_status" IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'A paid Product Binary source order cannot return to unpaid.' USING ERRCODE = '23514';
  END IF;
  IF OLD."payment_status" = 'paid' AND NEW."paid_at" IS DISTINCT FROM OLD."paid_at" THEN
    RAISE EXCEPTION 'Paid-at evidence is immutable.' USING ERRCODE = '23514';
  END IF;
  IF OLD."status"::text = 'delivered' AND NEW."status"::text IS DISTINCT FROM 'delivered' THEN
    RAISE EXCEPTION 'A delivered Product Binary source order cannot regress.' USING ERRCODE = '23514';
  END IF;
  IF OLD."status"::text = 'delivered' AND NEW."delivered_at" IS DISTINCT FROM OLD."delivered_at" THEN
    RAISE EXCEPTION 'Delivered-at evidence is immutable.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "orders_seal_product_binary_identity" ON "orders";
CREATE TRIGGER "orders_seal_product_binary_identity"
BEFORE UPDATE ON "orders"
FOR EACH ROW EXECUTE FUNCTION "seal_product_binary_order_identity"();

-- Recompute reserve entitlement independently of the caller. Because this
-- trigger is installed after legacy quarantine/backfill, every future insert
-- must be an exact paid Admin-order source; no new legacy exception exists.
CREATE OR REPLACE FUNCTION "validate_product_binary_funding_lot_source"()
RETURNS TRIGGER AS $$
DECLARE
  source_order RECORD;
  item_count INTEGER;
  exact_item_count INTEGER;
  expected_units INTEGER;
  expected_pu INTEGER;
  expected_margin DECIMAL(12,2);
  expected_allocation DECIMAL(12,2);
BEGIN
  SELECT orders."status"::text AS order_status, orders."payment_status", orders."financial_purpose",
         orders."paid_at", orders."delivered_at", seller."role"::text AS seller_role
  INTO source_order
  FROM "orders" orders
  JOIN "users" seller ON seller."id" = orders."seller_id"
  WHERE orders."id" = NEW."order_id"
  FOR SHARE OF orders, seller;

  SELECT COUNT(*)::INTEGER,
         COUNT(*) FILTER (WHERE item."snapshot_source" = 'product-binary-order-v1'
           AND item."binary_eligible_snapshot" IS NOT NULL AND item."pu_value_snapshot" IS NOT NULL
           AND item."company_unit_cost_snapshot" IS NOT NULL AND item."company_unit_margin_snapshot" IS NOT NULL
           AND item."snapshotted_at" IS NOT NULL)::INTEGER,
         COALESCE(SUM(CASE WHEN item."binary_eligible_snapshot" AND item."pu_value_snapshot" > 0
                           THEN item."quantity" ELSE 0 END),0)::INTEGER,
         COALESCE(SUM(CASE WHEN item."binary_eligible_snapshot" AND item."pu_value_snapshot" > 0
                           THEN item."quantity" * item."pu_value_snapshot" ELSE 0 END),0)::INTEGER,
         COALESCE(SUM(CASE WHEN item."binary_eligible_snapshot" AND item."pu_value_snapshot" > 0
                           THEN item."quantity" * item."company_unit_margin_snapshot" ELSE 0 END),0)::DECIMAL(12,2)
  INTO item_count, exact_item_count, expected_units, expected_pu, expected_margin
  FROM "order_items" item WHERE item."order_id" = NEW."order_id";

  expected_allocation := LEAST(GREATEST(0, expected_margin), expected_units * 20.00);
  IF NEW."order_id" IS NULL OR NEW."inventory_movement_id" IS NOT NULL
     OR source_order.order_status IS NULL
     OR source_order.order_status <> 'delivered' OR source_order.payment_status <> 'paid'
     OR source_order.financial_purpose <> 'commerce' OR source_order.seller_role <> 'admin'
     OR source_order.paid_at IS NULL OR source_order.delivered_at IS NULL
     OR item_count = 0 OR exact_item_count <> item_count
     OR NEW."snapshot_source" <> 'paid-delivered-admin-order'
     OR NEW."reconciliation_status" <> 'exact'
     OR NEW."snapshot_version" <> 'product-binary-order-v1'
     OR NEW."payment_status_snapshot" <> 'paid'
     OR NEW."paid_at_snapshot" IS DISTINCT FROM source_order.paid_at
     OR NEW."delivered_at_snapshot" IS DISTINCT FROM source_order.delivered_at
     OR NEW."eligible_units_snapshot" IS DISTINCT FROM expected_units
     OR NEW."total_pu_snapshot" IS DISTINCT FROM expected_pu
     OR NEW."gross_margin_snapshot" IS DISTINCT FROM expected_margin
     OR NEW."original_amount" IS DISTINCT FROM expected_allocation
     OR NEW."remaining_amount" IS DISTINCT FROM expected_allocation THEN
    RAISE EXCEPTION 'Product Binary funding lot does not match one exact paid-delivered Admin order.' USING ERRCODE = '23514';
  END IF;

  NEW."allocated_at" := GREATEST(source_order.paid_at, source_order.delivered_at);
  NEW."created_at" := transaction_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "product_binary_funding_lots_validate_source" ON "product_binary_funding_lots";
CREATE TRIGGER "product_binary_funding_lots_validate_source"
BEFORE INSERT ON "product_binary_funding_lots"
FOR EACH ROW EXECUTE FUNCTION "validate_product_binary_funding_lot_source"();

CREATE OR REPLACE FUNCTION "validate_product_binary_job_source"()
RETURNS TRIGGER AS $$
DECLARE
  source_order RECORD;
  item_count INTEGER;
  exact_item_count INTEGER;
  expected_units INTEGER;
  expected_pu INTEGER;
  expected_margin DECIMAL(12,2);
  expected_qualification TEXT;
BEGIN
  IF NEW."qualification_status" NOT IN ('qualified_paid_delivery', 'ineligible_zero_pu') THEN
    IF NEW."status" = 'completed' AND NEW."qualification_status" <> 'legacy_completed' THEN
      RAISE EXCEPTION 'A non-qualified Product Binary job cannot complete.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT orders."buyer_id", buyer."role"::text AS buyer_role, orders."status"::text AS order_status,
         orders."payment_status", orders."financial_purpose", orders."paid_at", orders."delivered_at"
  INTO source_order
  FROM "orders" orders
  JOIN "users" buyer ON buyer."id" = orders."buyer_id"
  WHERE orders."id" = NEW."order_id"
  FOR SHARE OF orders, buyer;

  SELECT COUNT(*)::INTEGER,
         COUNT(*) FILTER (WHERE item."snapshot_source" = 'product-binary-order-v1'
           AND item."binary_eligible_snapshot" IS NOT NULL AND item."pu_value_snapshot" IS NOT NULL
           AND item."company_unit_cost_snapshot" IS NOT NULL AND item."company_unit_margin_snapshot" IS NOT NULL
           AND item."snapshotted_at" IS NOT NULL)::INTEGER,
         COALESCE(SUM(CASE WHEN item."binary_eligible_snapshot" AND item."pu_value_snapshot" > 0
                           THEN item."quantity" ELSE 0 END),0)::INTEGER,
         COALESCE(SUM(CASE WHEN item."binary_eligible_snapshot" AND item."pu_value_snapshot" > 0
                           THEN item."quantity" * item."pu_value_snapshot" ELSE 0 END),0)::INTEGER,
         COALESCE(SUM(CASE WHEN item."binary_eligible_snapshot" AND item."pu_value_snapshot" > 0
                           THEN item."quantity" * GREATEST(0, item."unit_price" - COALESCE(item."unit_acquisition_cost", item."company_unit_cost_snapshot"))
                           ELSE 0 END),0)::DECIMAL(12,2)
  INTO item_count, exact_item_count, expected_units, expected_pu, expected_margin
  FROM "order_items" item WHERE item."order_id" = NEW."order_id";

  expected_qualification := CASE WHEN expected_pu > 0
    THEN 'qualified_paid_delivery' ELSE 'ineligible_zero_pu' END;
  IF source_order.order_status IS NULL
     OR source_order.buyer_role <> 'reseller' OR source_order.order_status <> 'delivered'
     OR source_order.payment_status <> 'paid' OR source_order.financial_purpose <> 'commerce'
     OR source_order.paid_at IS NULL OR source_order.delivered_at IS NULL
     OR item_count = 0 OR exact_item_count <> item_count
     OR NEW."buyer_user_id" IS DISTINCT FROM source_order.buyer_id
     OR NEW."payment_status_snapshot" <> 'paid'
     OR NEW."paid_at_snapshot" IS DISTINCT FROM source_order.paid_at
     OR NEW."delivered_at_snapshot" IS DISTINCT FROM source_order.delivered_at
     OR NEW."eligible_units_snapshot" IS DISTINCT FROM expected_units
     OR NEW."total_pu_snapshot" IS DISTINCT FROM expected_pu
     OR NEW."gross_margin_snapshot" IS DISTINCT FROM expected_margin
     OR NEW."snapshot_version" <> 'product-binary-order-v1'
     OR NEW."qualification_status" <> expected_qualification
     OR (expected_pu > 0 AND NEW."status" NOT IN ('pending','failed','completed'))
     OR (expected_pu = 0 AND NEW."status" <> 'completed') THEN
    RAISE EXCEPTION 'Product Binary settlement job does not match one exact paid-delivered reseller order.' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' OR OLD."qualification_status" NOT IN ('qualified_paid_delivery', 'ineligible_zero_pu') THEN
    NEW."qualified_at" := transaction_timestamp();
  ELSIF NEW."qualified_at" IS DISTINCT FROM OLD."qualified_at" THEN
    RAISE EXCEPTION 'Product Binary qualification timestamp is immutable.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "product_binary_jobs_validate_source" ON "product_binary_settlement_jobs";
CREATE TRIGGER "product_binary_jobs_validate_source"
BEFORE INSERT OR UPDATE ON "product_binary_settlement_jobs"
FOR EACH ROW EXECUTE FUNCTION "validate_product_binary_job_source"();

CREATE OR REPLACE FUNCTION "seal_product_binary_funding_lot"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."inventory_movement_id" IS DISTINCT FROM OLD."inventory_movement_id"
     OR NEW."order_id" IS DISTINCT FROM OLD."order_id"
     OR NEW."original_amount" IS DISTINCT FROM OLD."original_amount"
     OR NEW."snapshot_source" IS DISTINCT FROM OLD."snapshot_source"
     OR NEW."payment_status_snapshot" IS DISTINCT FROM OLD."payment_status_snapshot"
     OR NEW."paid_at_snapshot" IS DISTINCT FROM OLD."paid_at_snapshot"
     OR NEW."delivered_at_snapshot" IS DISTINCT FROM OLD."delivered_at_snapshot"
     OR NEW."eligible_units_snapshot" IS DISTINCT FROM OLD."eligible_units_snapshot"
     OR NEW."total_pu_snapshot" IS DISTINCT FROM OLD."total_pu_snapshot"
     OR NEW."gross_margin_snapshot" IS DISTINCT FROM OLD."gross_margin_snapshot"
     OR NEW."snapshot_version" IS DISTINCT FROM OLD."snapshot_version"
     OR NEW."reconciliation_status" IS DISTINCT FROM OLD."reconciliation_status"
     OR NEW."allocated_at" IS DISTINCT FROM OLD."allocated_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
     OR NEW."remaining_amount" < 0
     OR NEW."remaining_amount" > OLD."remaining_amount" THEN
    RAISE EXCEPTION 'Product Binary funding provenance is immutable and reserve balance may only decrease.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "product_binary_funding_lots_immutable" ON "product_binary_funding_lots";
CREATE TRIGGER "product_binary_funding_lots_immutable"
BEFORE UPDATE OR DELETE ON "product_binary_funding_lots"
FOR EACH ROW EXECUTE FUNCTION "seal_product_binary_funding_lot"();

CREATE OR REPLACE FUNCTION "validate_product_binary_funding_lot_balance"()
RETURNS TRIGGER AS $$
DECLARE
  consumed_amount DECIMAL(12,2);
BEGIN
  IF NEW."reconciliation_status" <> 'exact' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM(consumption."amount"), 0)
  INTO consumed_amount
  FROM "product_binary_funding_consumptions" consumption
  WHERE consumption."funding_lot_id" = NEW."id"
    AND consumption."is_unfunded" = false;

  IF NEW."remaining_amount" IS DISTINCT FROM NEW."original_amount" - consumed_amount THEN
    RAISE EXCEPTION 'Product Binary funding-lot balance does not reconcile to append-only consumption.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "product_binary_funding_lots_validate_balance" ON "product_binary_funding_lots";
CREATE CONSTRAINT TRIGGER "product_binary_funding_lots_validate_balance"
AFTER INSERT OR UPDATE ON "product_binary_funding_lots"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_product_binary_funding_lot_balance"();

CREATE OR REPLACE FUNCTION "seal_product_binary_source_rows"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Product Binary source snapshots and order-event lineage are immutable.' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "product_binary_order_events_immutable" ON "product_binary_order_events";
CREATE TRIGGER "product_binary_order_events_immutable"
BEFORE UPDATE OR DELETE ON "product_binary_order_events"
FOR EACH ROW EXECUTE FUNCTION "seal_product_binary_source_rows"();

CREATE OR REPLACE FUNCTION "seal_product_binary_job_snapshots"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'completed' THEN
    RAISE EXCEPTION 'Completed Product Binary job is immutable.' USING ERRCODE = '23514';
  END IF;
  IF OLD."qualified_at" IS NOT NULL
     AND ROW(NEW."order_id", NEW."buyer_user_id", NEW."payment_status_snapshot", NEW."paid_at_snapshot",
             NEW."delivered_at_snapshot", NEW."eligible_units_snapshot", NEW."total_pu_snapshot",
             NEW."gross_margin_snapshot", NEW."snapshot_version", NEW."qualified_at")
         IS DISTINCT FROM
         ROW(OLD."order_id", OLD."buyer_user_id", OLD."payment_status_snapshot", OLD."paid_at_snapshot",
             OLD."delivered_at_snapshot", OLD."eligible_units_snapshot", OLD."total_pu_snapshot",
             OLD."gross_margin_snapshot", OLD."snapshot_version", OLD."qualified_at") THEN
    RAISE EXCEPTION 'Qualified Product Binary job snapshots are immutable.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "product_binary_jobs_seal_snapshots" ON "product_binary_settlement_jobs";
CREATE TRIGGER "product_binary_jobs_seal_snapshots"
BEFORE UPDATE ON "product_binary_settlement_jobs"
FOR EACH ROW EXECUTE FUNCTION "seal_product_binary_job_snapshots"();

-- Supersede the mutable-product validator from 1430. Every positive event must
-- bind one exact qualified job and its paid/delivered snapshots.
CREATE OR REPLACE FUNCTION "validate_product_binary_order_event_source"()
RETURNS TRIGGER AS $$
DECLARE
  source_job RECORD;
BEGIN
  SELECT job.* INTO source_job
  FROM "product_binary_settlement_jobs" job
  WHERE job."id" = NEW."settlement_job_id"
    AND job."order_id" = NEW."order_id"
  FOR SHARE;

  IF NOT FOUND
     OR source_job."status" NOT IN ('pending', 'failed')
     OR source_job."qualification_status" <> 'qualified_paid_delivery'
     OR source_job."snapshot_version" <> 'product-binary-order-v1'
     OR source_job."payment_status_snapshot" <> 'paid'
     OR source_job."paid_at_snapshot" IS NULL
     OR source_job."delivered_at_snapshot" IS NULL
     OR source_job."total_pu_snapshot" <= 0
     OR NEW."buyer_user_id" IS DISTINCT FROM source_job."buyer_user_id"
     OR NEW."eligible_units" IS DISTINCT FROM source_job."eligible_units_snapshot"
     OR NEW."total_pu" IS DISTINCT FROM source_job."total_pu_snapshot"
     OR NEW."recorded_gross_margin" IS DISTINCT FROM source_job."gross_margin_snapshot" THEN
    RAISE EXCEPTION 'Product Binary event does not match one exact paid-delivered order qualification.' USING ERRCODE = '23514';
  END IF;

  NEW."payment_status_snapshot" := source_job."payment_status_snapshot";
  NEW."paid_at_snapshot" := source_job."paid_at_snapshot";
  NEW."delivered_at_snapshot" := source_job."delivered_at_snapshot";
  NEW."snapshot_version" := source_job."snapshot_version";
  NEW."processed_at" := transaction_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_product_binary_job_completion"()
RETURNS TRIGGER AS $$
DECLARE
  exact_order_event_count INTEGER;
BEGIN
  IF NEW."status" <> 'completed' THEN
    RETURN NEW;
  END IF;
  IF NEW."completed_at" IS NULL OR NEW."payment_status_snapshot" <> 'paid'
     OR NEW."paid_at_snapshot" IS NULL OR NEW."delivered_at_snapshot" IS NULL
     OR NEW."snapshot_version" <> 'product-binary-order-v1' THEN
    RAISE EXCEPTION 'Completed Product Binary job lacks exact paid-delivered snapshots.' USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)::INTEGER INTO exact_order_event_count
  FROM "product_binary_order_events" event
  WHERE event."settlement_job_id" = NEW."id"
    AND event."order_id" = NEW."order_id"
    AND event."buyer_user_id" = NEW."buyer_user_id"
    AND event."eligible_units" = NEW."eligible_units_snapshot"
    AND event."total_pu" = NEW."total_pu_snapshot"
    AND event."recorded_gross_margin" = NEW."gross_margin_snapshot"
    AND event."snapshot_version" = NEW."snapshot_version";

  IF NEW."qualification_status" = 'qualified_paid_delivery'
     AND NEW."total_pu_snapshot" > 0
     AND exact_order_event_count <> 1 THEN
    RAISE EXCEPTION 'Positive-PU completed job must bind one exact snapshotted order event.' USING ERRCODE = '23514';
  ELSIF NEW."qualification_status" = 'ineligible_zero_pu'
     AND NEW."total_pu_snapshot" = 0
     AND exact_order_event_count <> 0 THEN
    RAISE EXCEPTION 'Auditable zero-PU job cannot claim a Product Binary order event.' USING ERRCODE = '23514';
  ELSIF NEW."qualification_status" NOT IN ('qualified_paid_delivery', 'ineligible_zero_pu', 'legacy_completed') THEN
    RAISE EXCEPTION 'Unqualified Product Binary job cannot complete.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "product_binary_jobs_validate_completion" ON "product_binary_settlement_jobs";
CREATE CONSTRAINT TRIGGER "product_binary_jobs_validate_completion"
AFTER INSERT OR UPDATE ON "product_binary_settlement_jobs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_product_binary_job_completion"();

ALTER TABLE "product_binary_settlement_jobs"
  ADD CONSTRAINT "product_binary_settlement_jobs_status_check"
    CHECK ("status" IN ('pending','failed','completed','waiting_payment','reconciliation_required')) NOT VALID,
  ADD CONSTRAINT "product_binary_settlement_jobs_qualification_check"
    CHECK ("qualification_status" IN (
      'awaiting_qualification','waiting_for_paid_delivery','qualified_paid_delivery',
      'ineligible_zero_pu','legacy_snapshot_reconciliation','legacy_completed'
    )) NOT VALID;
ALTER TABLE "product_binary_settlement_jobs"
  VALIDATE CONSTRAINT "product_binary_settlement_jobs_status_check";
ALTER TABLE "product_binary_settlement_jobs"
  VALIDATE CONSTRAINT "product_binary_settlement_jobs_qualification_check";

CREATE TRIGGER "product_binary_funding_lots_protected_write"
BEFORE INSERT OR UPDATE OR DELETE ON "product_binary_funding_lots"
FOR EACH ROW EXECUTE FUNCTION "require_internal_financial_ledger_write"();

COMMIT;
