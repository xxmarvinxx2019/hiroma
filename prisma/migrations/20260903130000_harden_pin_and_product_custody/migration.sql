BEGIN;

ALTER TYPE "PinStatus" ADD VALUE IF NOT EXISTS 'in_transit';

-- PostgreSQL requires a commit before a newly-added enum value can be used by
-- trigger definitions in the remainder of this migration.
COMMIT;
BEGIN;

ALTER TABLE "pins"
  ADD COLUMN IF NOT EXISTS "funding_pin_transfer_id" UUID,
  ADD COLUMN IF NOT EXISTS "generated_by_actor_id" UUID,
  ADD COLUMN IF NOT EXISTS "cancellation_disposition" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "cancellation_reference" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "cancellation_amount" DECIMAL(12,2);

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "payment_sender_name" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "payment_evidence_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "payment_recorded_by_actor_id" UUID,
  ADD COLUMN IF NOT EXISTS "payment_verified_by_actor_id" UUID;

ALTER TABLE "pin_requests"
  ADD COLUMN IF NOT EXISTS "approved_by_actor_id" UUID,
  ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "rejected_by_actor_id" UUID,
  ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMPTZ(6);

ALTER TABLE "inventory_transfers"
  ADD COLUMN IF NOT EXISTS "dispatched_by_actor_id" UUID,
  ADD COLUMN IF NOT EXISTS "received_by_actor_id" UUID;

CREATE TABLE IF NOT EXISTS "pin_transfers" (
  "id" UUID NOT NULL,
  "reference_number" VARCHAR(40) NOT NULL,
  "admin_id" TEXT NOT NULL,
  "recipient_id" TEXT NOT NULL,
  "initiated_by_actor_id" UUID,
  "package_id" TEXT NOT NULL,
  "pin_type" VARCHAR(24) NOT NULL,
  "upgrade_from_package_id" TEXT,
  "quantity" INTEGER NOT NULL,
  "unit_allocation" DECIMAL(12,2) NOT NULL,
  "reference_value" DECIMAL(12,2) NOT NULL,
  "sale_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" VARCHAR(32) NOT NULL DEFAULT 'in_transit',
  "notes" TEXT,
  "dispatched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "received_at" TIMESTAMPTZ(6),
  "received_by_actor_id" UUID,
  "rejected_at" TIMESTAMPTZ(6),
  "rejected_by_actor_id" UUID,
  "rejection_reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pin_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pin_transfers_reference_number_key" UNIQUE ("reference_number"),
  CONSTRAINT "pin_transfers_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "pin_transfers_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "pin_transfers_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT,
  CONSTRAINT "pin_transfers_upgrade_from_package_id_fkey" FOREIGN KEY ("upgrade_from_package_id") REFERENCES "packages"("id") ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "pin_transfers_recipient_id_status_created_at_idx"
  ON "pin_transfers"("recipient_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "pin_transfers_admin_id_created_at_idx"
  ON "pin_transfers"("admin_id", "created_at");
CREATE INDEX IF NOT EXISTS "pins_funding_pin_transfer_id_idx"
  ON "pins"("funding_pin_transfer_id");

ALTER TABLE "pins"
  DROP CONSTRAINT IF EXISTS "pins_funding_pin_transfer_id_fkey",
  ADD CONSTRAINT "pins_funding_pin_transfer_id_fkey"
    FOREIGN KEY ("funding_pin_transfer_id") REFERENCES "pin_transfers"("id") ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS "admin_stock_receipts" (
  "id" UUID NOT NULL,
  "reference_number" VARCHAR(40) NOT NULL,
  "source_type" VARCHAR(32) NOT NULL,
  "source_reference" VARCHAR(120) NOT NULL,
  "source_reference_key" VARCHAR(120) NOT NULL,
  "admin_id" TEXT NOT NULL,
  "received_by_actor_id" UUID,
  "total_units" INTEGER NOT NULL,
  "notes" TEXT,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_stock_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_stock_receipts_reference_number_key" UNIQUE ("reference_number"),
  CONSTRAINT "admin_stock_receipts_source_reference_key"
    UNIQUE ("admin_id", "source_type", "source_reference_key"),
  CONSTRAINT "admin_stock_receipts_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "admin_stock_receipt_items" (
  "id" UUID NOT NULL,
  "receipt_id" UUID NOT NULL,
  "product_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_cost" DECIMAL(10,2) NOT NULL,
  "stock_before" INTEGER NOT NULL,
  "stock_after" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_stock_receipt_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_stock_receipt_items_receipt_id_product_id_key" UNIQUE ("receipt_id", "product_id"),
  CONSTRAINT "admin_stock_receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "admin_stock_receipts"("id") ON DELETE RESTRICT,
  CONSTRAINT "admin_stock_receipt_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT,
  CONSTRAINT "admin_stock_receipt_items_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "admin_stock_receipt_items_cost_check" CHECK ("unit_cost" >= 0),
  CONSTRAINT "admin_stock_receipt_items_stock_check" CHECK ("stock_after" = "stock_before" + "quantity")
);

CREATE INDEX IF NOT EXISTS "admin_stock_receipts_admin_id_received_at_idx"
  ON "admin_stock_receipts"("admin_id", "received_at");
CREATE INDEX IF NOT EXISTS "admin_stock_receipts_source_type_source_reference_idx"
  ON "admin_stock_receipts"("source_type", "source_reference");
CREATE INDEX IF NOT EXISTS "admin_stock_receipt_items_product_id_created_at_idx"
  ON "admin_stock_receipt_items"("product_id", "created_at");

UPDATE "pins"
SET "cancellation_disposition" = 'legacy_unclassified',
    "cancellation_amount" = 0
WHERE "status" = 'cancelled'::"PinStatus"
  AND "cancellation_disposition" IS NULL;

CREATE OR REPLACE FUNCTION "protect_registration_snapshot_identity"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."pin_code" IS DISTINCT FROM NEW."pin_code"
     OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
     OR OLD."pin_allocation_snapshot" IS DISTINCT FROM NEW."pin_allocation_snapshot"
     OR OLD."registration_package_name_snapshot" IS DISTINCT FROM NEW."registration_package_name_snapshot"
     OR OLD."registration_customer_payment_snapshot" IS DISTINCT FROM NEW."registration_customer_payment_snapshot"
     OR OLD."registration_reseller_value_snapshot" IS DISTINCT FROM NEW."registration_reseller_value_snapshot"
     OR OLD."registration_acquisition_cost_snapshot" IS DISTINCT FROM NEW."registration_acquisition_cost_snapshot"
     OR OLD."registration_acquisition_tier_snapshot" IS DISTINCT FROM NEW."registration_acquisition_tier_snapshot"
     OR OLD."registration_direct_allocation_snapshot" IS DISTINCT FROM NEW."registration_direct_allocation_snapshot"
     OR OLD."registration_binary_allocation_snapshot" IS DISTINCT FROM NEW."registration_binary_allocation_snapshot"
     OR OLD."registration_points_snapshot" IS DISTINCT FROM NEW."registration_points_snapshot"
     OR OLD."registration_product_line_count_snapshot" IS DISTINCT FROM NEW."registration_product_line_count_snapshot"
     OR OLD."registration_units_snapshot" IS DISTINCT FROM NEW."registration_units_snapshot" THEN
    RAISE EXCEPTION 'Issued PIN financial snapshots are immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD."pin_allocation_snapshot" IS NOT NULL AND (
       OLD."package_id" IS DISTINCT FROM NEW."package_id"
       OR OLD."city_dist_id" IS DISTINCT FROM NEW."city_dist_id"
       OR OLD."generated_by" IS DISTINCT FROM NEW."generated_by"
       OR OLD."generated_by_actor_id" IS DISTINCT FROM NEW."generated_by_actor_id"
       OR OLD."funding_order_id" IS DISTINCT FROM NEW."funding_order_id"
       OR OLD."funding_pin_request_id" IS DISTINCT FROM NEW."funding_pin_request_id"
       OR OLD."funding_pin_transfer_id" IS DISTINCT FROM NEW."funding_pin_transfer_id"
       OR OLD."pin_type" IS DISTINCT FROM NEW."pin_type"
       OR OLD."upgrade_from_package_id" IS DISTINCT FROM NEW."upgrade_from_package_id"
     ) THEN
    RAISE EXCEPTION 'Issued PIN ownership, source, generator, package, and type are immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" IS DISTINCT FROM NEW."status" AND NOT (
       (OLD."status" = 'in_transit'::"PinStatus" AND NEW."status" IN ('unused'::"PinStatus", 'cancelled'::"PinStatus"))
       OR
       (OLD."status" = 'unused'::"PinStatus" AND NEW."status" IN ('used'::"PinStatus", 'cancelled'::"PinStatus", 'expired'::"PinStatus"))
     ) THEN
    RAISE EXCEPTION 'PIN status transition is not monotonic.' USING ERRCODE = '55000';
  END IF;
  IF OLD."used_by" IS NOT NULL AND (
       OLD."used_by" IS DISTINCT FROM NEW."used_by"
       OR OLD."used_at" IS DISTINCT FROM NEW."used_at"
     ) THEN
    RAISE EXCEPTION 'A redeemed PIN cannot be rebound or restamped.' USING ERRCODE = '55000';
  END IF;
  IF OLD."cancelled_at" IS NOT NULL AND (
       OLD."cancelled_at" IS DISTINCT FROM NEW."cancelled_at"
       OR OLD."cancelled_by" IS DISTINCT FROM NEW."cancelled_by"
       OR OLD."cancellation_reason" IS DISTINCT FROM NEW."cancellation_reason"
       OR OLD."cancellation_disposition" IS DISTINCT FROM NEW."cancellation_disposition"
       OR OLD."cancellation_reference" IS DISTINCT FROM NEW."cancellation_reference"
       OR OLD."cancellation_amount" IS DISTINCT FROM NEW."cancellation_amount"
     ) THEN
    RAISE EXCEPTION 'PIN cancellation evidence is immutable.' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'used'::"PinStatus" AND (NEW."used_by" IS NULL OR NEW."used_at" IS NULL) THEN
    RAISE EXCEPTION 'A used PIN must identify its member and redemption time.' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'cancelled'::"PinStatus" AND (
       NEW."cancelled_at" IS NULL
       OR NEW."cancelled_by" IS NULL
       OR LENGTH(TRIM(COALESCE(NEW."cancellation_reason", ''))) < 3
       OR NEW."cancellation_disposition" NOT IN ('refunded', 'credited', 'retained', 'internal_transfer_rejected', 'legacy_unclassified')
       OR NEW."cancellation_amount" IS NULL
       OR NEW."cancellation_amount" < 0
       OR (NEW."cancellation_disposition" IN ('refunded', 'credited')
           AND LENGTH(TRIM(COALESCE(NEW."cancellation_reference", ''))) < 3)
     ) THEN
    RAISE EXCEPTION 'A cancelled PIN requires complete immutable financial disposition evidence.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "protect_pin_transfer"()
RETURNS TRIGGER AS $$
DECLARE
  admin_role TEXT;
  recipient_role TEXT;
  recipient_level TEXT;
  recipient_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PIN transfer evidence is append-only.' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT "role"::text INTO admin_role FROM "users" WHERE "id" = NEW."admin_id" FOR SHARE;
    SELECT users."role"::text, profiles."dist_level"::text, users."status"::text
    INTO recipient_role, recipient_level, recipient_status
    FROM "users" users
    LEFT JOIN "distributor_profiles" profiles ON profiles."user_id" = users."id"
    WHERE users."id" = NEW."recipient_id" FOR SHARE OF users;
    IF admin_role <> 'admin'
       OR recipient_role <> 'city'
       OR recipient_level <> 'branch'
       OR recipient_status <> 'active'
       OR NEW."recipient_id" = NEW."admin_id"
       OR NEW."quantity" <= 0 OR NEW."quantity" > 50
       OR NEW."unit_allocation" <= 0
       OR NEW."reference_value" <> ROUND(NEW."unit_allocation" * NEW."quantity", 2)
       OR NEW."sale_value" <> 0
       OR NEW."status" <> 'in_transit'
       OR NEW."pin_type" NOT IN ('registration', 'upgrade')
       OR (NEW."pin_type" = 'upgrade' AND NEW."upgrade_from_package_id" IS NULL) THEN
      RAISE EXCEPTION 'PIN transfer must be a zero-revenue Admin-to-Branch custody movement with exact economics.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(OLD."reference_number", OLD."admin_id", OLD."recipient_id", OLD."initiated_by_actor_id",
         OLD."package_id", OLD."pin_type", OLD."upgrade_from_package_id", OLD."quantity",
         OLD."unit_allocation", OLD."reference_value", OLD."sale_value", OLD."notes",
         OLD."dispatched_at", OLD."created_at")
     IS DISTINCT FROM
     ROW(NEW."reference_number", NEW."admin_id", NEW."recipient_id", NEW."initiated_by_actor_id",
         NEW."package_id", NEW."pin_type", NEW."upgrade_from_package_id", NEW."quantity",
         NEW."unit_allocation", NEW."reference_value", NEW."sale_value", NEW."notes",
         NEW."dispatched_at", NEW."created_at") THEN
    RAISE EXCEPTION 'PIN transfer financial and custody identity is immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" IS DISTINCT FROM NEW."status" AND NOT (
       OLD."status" = 'in_transit' AND NEW."status" IN ('received', 'rejected')
     ) THEN
    RAISE EXCEPTION 'PIN transfer status transition is not monotonic.' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'received' AND (NEW."received_at" IS NULL OR NEW."received_by_actor_id" IS NULL) THEN
    RAISE EXCEPTION 'Received PIN transfer requires receiving actor and time.' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'rejected' AND (
       NEW."rejected_at" IS NULL OR NEW."rejected_by_actor_id" IS NULL
       OR LENGTH(TRIM(COALESCE(NEW."rejection_reason", ''))) < 3
     ) THEN
    RAISE EXCEPTION 'Rejected PIN transfer requires actor, time, and reason.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "pin_transfers_protect" ON "pin_transfers";
CREATE TRIGGER "pin_transfers_protect"
BEFORE INSERT OR UPDATE OR DELETE ON "pin_transfers"
FOR EACH ROW EXECUTE FUNCTION "protect_pin_transfer"();

CREATE OR REPLACE FUNCTION "validate_pin_transfer_batch"()
RETURNS TRIGGER AS $$
DECLARE
  linked_count INTEGER;
  linked_total DECIMAL(12,2);
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER,
         COALESCE(SUM("pin_allocation_snapshot"), 0)::DECIMAL(12,2),
         COUNT(*) FILTER (
           WHERE ("funding_order_id" IS NOT NULL OR "funding_pin_request_id" IS NOT NULL)
             OR ("status" = 'in_transit'::"PinStatus" AND NEW."status" <> 'in_transit')
             OR ("status" = 'unused'::"PinStatus" AND NEW."status" <> 'received')
             OR ("status" NOT IN ('in_transit'::"PinStatus", 'unused'::"PinStatus")
                 AND NEW."status" IN ('in_transit', 'received'))
             OR (NEW."status" = 'rejected' AND (
                  "status" <> 'cancelled'::"PinStatus"
                  OR "cancellation_disposition" <> 'internal_transfer_rejected'
                ))
         )::INTEGER
  INTO linked_count, linked_total, invalid_count
  FROM "pins" WHERE "funding_pin_transfer_id" = NEW."id";
  IF linked_count <> NEW."quantity"
     OR linked_total <> NEW."reference_value"
     OR invalid_count <> 0 THEN
    RAISE EXCEPTION 'PIN transfer batch is incomplete or its custody states are inconsistent.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "pin_transfers_validate_batch" ON "pin_transfers";
CREATE CONSTRAINT TRIGGER "pin_transfers_validate_batch"
AFTER INSERT OR UPDATE ON "pin_transfers"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_pin_transfer_batch"();

CREATE OR REPLACE FUNCTION "pin_has_exact_paid_source"(target_pin_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  issued RECORD;
  source_order RECORD;
  source_request RECORD;
  source_transfer RECORD;
  linked_count INTEGER;
  linked_total DECIMAL(12,2);
BEGIN
  SELECT * INTO issued FROM "pins" WHERE "id" = target_pin_id FOR SHARE;
  IF NOT FOUND OR num_nonnulls(
       issued."funding_order_id",
       issued."funding_pin_request_id",
       issued."funding_pin_transfer_id"
     ) <> 1 THEN
    RETURN false;
  END IF;

  IF issued."funding_order_id" IS NOT NULL THEN
    SELECT * INTO source_order FROM "orders" WHERE "id" = issued."funding_order_id" FOR UPDATE;
    SELECT COUNT(*)::INTEGER, COALESCE(SUM("pin_allocation_snapshot"), 0)::DECIMAL(12,2)
    INTO linked_count, linked_total
    FROM "pins" WHERE "funding_order_id" = issued."funding_order_id";
    RETURN COALESCE(source_order."id" IS NOT NULL
      AND source_order."buyer_id" = issued."city_dist_id"
      AND source_order."seller_id" = issued."generated_by"
      AND source_order."financial_purpose" = 'pin_sale'
      AND source_order."status" = 'delivered'::"OrderStatus"
      AND source_order."payment_status" = 'paid'
      AND source_order."paid_at" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "order_items" WHERE "order_id" = source_order."id")
      AND NOT EXISTS (SELECT 1 FROM "pos_transactions" WHERE "order_id" = source_order."id")
      AND linked_count > 0
      AND linked_total = source_order."total_amount", false);
  END IF;

  IF issued."funding_pin_request_id" IS NOT NULL THEN
    SELECT * INTO source_request FROM "pin_requests"
    WHERE "id" = issued."funding_pin_request_id" FOR UPDATE;
    SELECT COUNT(*)::INTEGER, COALESCE(SUM("pin_allocation_snapshot"), 0)::DECIMAL(12,2)
    INTO linked_count, linked_total
    FROM "pins" WHERE "funding_pin_request_id" = issued."funding_pin_request_id";
    RETURN COALESCE(source_request."id" IS NOT NULL
      AND source_request."city_dist_id" = issued."city_dist_id"
      AND source_request."package_id" = issued."package_id"
      AND source_request."status" = 'approved'
      AND source_request."payment_status" = 'paid'
      AND linked_count = source_request."quantity"
      AND linked_total = source_request."total_amount"
      AND "registration_snapshot_matches_pin"(source_request."registration_snapshot", issued."id"), false);
  END IF;

  SELECT * INTO source_transfer FROM "pin_transfers"
  WHERE "id" = issued."funding_pin_transfer_id" FOR UPDATE;
  SELECT COUNT(*)::INTEGER, COALESCE(SUM("pin_allocation_snapshot"), 0)::DECIMAL(12,2)
  INTO linked_count, linked_total
  FROM "pins" WHERE "funding_pin_transfer_id" = issued."funding_pin_transfer_id";
  RETURN COALESCE(source_transfer."id" IS NOT NULL
    AND source_transfer."admin_id" = issued."generated_by"
    AND source_transfer."recipient_id" = issued."city_dist_id"
    AND source_transfer."package_id" = issued."package_id"
    AND source_transfer."pin_type" = issued."pin_type"
    AND source_transfer."upgrade_from_package_id" IS NOT DISTINCT FROM issued."upgrade_from_package_id"
    AND source_transfer."sale_value" = 0
    AND linked_count = source_transfer."quantity"
    AND linked_total = source_transfer."reference_value"
    AND (
      (issued."status" = 'in_transit'::"PinStatus" AND source_transfer."status" = 'in_transit')
      OR
      (issued."status" IN ('unused'::"PinStatus", 'used'::"PinStatus") AND source_transfer."status" = 'received')
    ), false);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_pin_paid_source"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" IN ('in_transit'::"PinStatus", 'unused'::"PinStatus", 'used'::"PinStatus")
     AND NEW."pin_allocation_snapshot" IS NOT NULL
     AND NOT "pin_has_exact_paid_source"(NEW."id") THEN
    RAISE EXCEPTION 'PIN is not backed by exactly one paid source or accepted zero-revenue custody transfer.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "protect_paid_pin_sale_order"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."financial_purpose" = 'pin_sale' AND (
         NEW."status" <> 'delivered'::"OrderStatus"
         OR NEW."payment_status" <> 'paid'
         OR NEW."paid_at" IS NULL
         OR NEW."delivered_at" IS NULL
         OR LENGTH(TRIM(COALESCE(NEW."payment_method", ''))) < 2
         OR LENGTH(TRIM(COALESCE(NEW."payment_reference", ''))) < 3
         OR LENGTH(TRIM(COALESCE(NEW."payment_sender_name", ''))) < 2
         OR NEW."payment_evidence_at" IS NULL
         OR NEW."payment_recorded_by_actor_id" IS NULL
         OR NEW."payment_verified_by_actor_id" IS NULL
       ) THEN
      RAISE EXCEPTION 'A new PIN sale requires complete paid receipt evidence.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."financial_purpose" IS DISTINCT FROM NEW."financial_purpose" THEN
    RAISE EXCEPTION 'Order financial purpose is immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD."financial_purpose" = 'pin_sale' AND (
       OLD."buyer_id" IS DISTINCT FROM NEW."buyer_id"
       OR OLD."seller_id" IS DISTINCT FROM NEW."seller_id"
       OR OLD."total_amount" IS DISTINCT FROM NEW."total_amount"
       OR OLD."status" IS DISTINCT FROM NEW."status"
       OR OLD."payment_method" IS DISTINCT FROM NEW."payment_method"
       OR OLD."payment_reference" IS DISTINCT FROM NEW."payment_reference"
       OR OLD."payment_status" IS DISTINCT FROM NEW."payment_status"
       OR OLD."payment_sender_name" IS DISTINCT FROM NEW."payment_sender_name"
       OR OLD."payment_evidence_at" IS DISTINCT FROM NEW."payment_evidence_at"
       OR OLD."payment_recorded_by_actor_id" IS DISTINCT FROM NEW."payment_recorded_by_actor_id"
       OR OLD."payment_verified_by_actor_id" IS DISTINCT FROM NEW."payment_verified_by_actor_id"
       OR OLD."paid_at" IS DISTINCT FROM NEW."paid_at"
       OR OLD."delivered_at" IS DISTINCT FROM NEW."delivered_at"
     ) THEN
    RAISE EXCEPTION 'A PIN funding order and its payment evidence are immutable after issuance.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "orders_protect_paid_pin_sale" ON "orders";
CREATE TRIGGER "orders_protect_paid_pin_sale"
BEFORE INSERT OR UPDATE ON "orders"
FOR EACH ROW EXECUTE FUNCTION "protect_paid_pin_sale_order"();

CREATE OR REPLACE FUNCTION "require_pin_request_decision_actor"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."approved_at" IS NOT NULL AND (
       OLD."approved_at" IS DISTINCT FROM NEW."approved_at"
       OR OLD."approved_by_actor_id" IS DISTINCT FROM NEW."approved_by_actor_id"
     ) THEN
    RAISE EXCEPTION 'PIN request approval evidence is immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD."rejected_at" IS NOT NULL AND (
       OLD."rejected_at" IS DISTINCT FROM NEW."rejected_at"
       OR OLD."rejected_by_actor_id" IS DISTINCT FROM NEW."rejected_by_actor_id"
     ) THEN
    RAISE EXCEPTION 'PIN request rejection evidence is immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'pending' AND NEW."status" = 'approved'
     AND (NEW."approved_at" IS NULL OR NEW."approved_by_actor_id" IS NULL) THEN
    RAISE EXCEPTION 'PIN request approval requires the actual approving actor and time.' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'pending' AND NEW."status" = 'rejected'
     AND (NEW."rejected_at" IS NULL OR NEW."rejected_by_actor_id" IS NULL) THEN
    RAISE EXCEPTION 'PIN request rejection requires the actual rejecting actor and time.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "pin_requests_require_decision_actor" ON "pin_requests";
CREATE TRIGGER "pin_requests_require_decision_actor"
BEFORE UPDATE ON "pin_requests"
FOR EACH ROW EXECUTE FUNCTION "require_pin_request_decision_actor"();

CREATE OR REPLACE FUNCTION "validate_new_pin_request_payment_evidence"()
RETURNS TRIGGER AS $$
DECLARE
  recipient RECORD;
BEGIN
  SELECT users."role"::text AS role, users."status"::text AS status,
         profiles."dist_level"::text AS level, profiles."is_active" AS profile_active
  INTO recipient
  FROM "users" users
  LEFT JOIN "distributor_profiles" profiles ON profiles."user_id" = users."id"
  WHERE users."id" = NEW."city_dist_id";
  IF recipient.role <> 'city'
     OR recipient.status <> 'active'
     OR recipient.level <> 'city'
     OR recipient.profile_active IS NOT TRUE
     OR NEW."payment_method" NOT IN ('gcash', 'bank_transfer')
     OR LENGTH(TRIM(COALESCE(NEW."payment_reference", ''))) < 3
     OR LENGTH(TRIM(COALESCE(NEW."payment_sender_name", ''))) < 2
     OR NEW."payment_datetime" IS NULL
     OR NEW."payment_datetime" > transaction_timestamp() + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'New PIN requests require an active City Distributor and complete electronic payment evidence.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "pin_requests_validate_new_payment_evidence" ON "pin_requests";
CREATE TRIGGER "pin_requests_validate_new_payment_evidence"
BEFORE INSERT ON "pin_requests"
FOR EACH ROW EXECUTE FUNCTION "validate_new_pin_request_payment_evidence"();

CREATE OR REPLACE FUNCTION "validate_registration_pin_snapshot"()
RETURNS TRIGGER AS $$
DECLARE
  totals RECORD;
BEGIN
  IF NEW."pin_type" <> 'registration' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT'
     AND NEW."status" NOT IN ('unused'::"PinStatus", 'in_transit'::"PinStatus") THEN
    RAISE EXCEPTION 'A registration PIN must be issued unused or in transit with a complete immutable snapshot.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."status" IN ('cancelled'::"PinStatus", 'expired'::"PinStatus") THEN
    RETURN NEW;
  END IF;
  IF NEW."pin_allocation_snapshot" IS NULL
     OR NEW."registration_package_name_snapshot" IS NULL
     OR NEW."registration_customer_payment_snapshot" IS NULL
     OR NEW."registration_reseller_value_snapshot" IS NULL
     OR NEW."registration_acquisition_cost_snapshot" IS NULL
     OR NEW."registration_acquisition_tier_snapshot" IS NULL
     OR NEW."registration_acquisition_tier_snapshot" NOT IN ('admin', 'city', 'branch')
     OR NEW."registration_direct_allocation_snapshot" IS NULL
     OR NEW."registration_binary_allocation_snapshot" IS NULL
     OR NEW."registration_points_snapshot" IS NULL
     OR NEW."registration_points_snapshot" <= 0
     OR NEW."registration_product_line_count_snapshot" IS NULL
     OR NEW."registration_product_line_count_snapshot" <= 0
     OR NEW."registration_units_snapshot" IS NULL
     OR NEW."registration_units_snapshot" <= 0
     OR NEW."registration_customer_payment_snapshot" <> NEW."registration_reseller_value_snapshot" + NEW."pin_allocation_snapshot"
     OR NEW."registration_binary_allocation_snapshot" <> NEW."registration_points_snapshot" * 0.5
     OR NEW."registration_direct_allocation_snapshot" + NEW."registration_binary_allocation_snapshot" > NEW."pin_allocation_snapshot"
     OR NEW."registration_reseller_value_snapshot" < NEW."registration_acquisition_cost_snapshot" THEN
    RAISE EXCEPTION 'Registration PIN snapshot is missing, inconsistent, or underfunded.' USING ERRCODE = '23514';
  END IF;
  SELECT
    COUNT(*)::INTEGER AS product_count,
    COALESCE(SUM("quantity"), 0)::INTEGER AS units,
    COALESCE(SUM("srp_snapshot" * "quantity"), 0)::DECIMAL(12,2) AS customer_payment,
    COALESCE(SUM("reseller_price_snapshot" * "quantity"), 0)::DECIMAL(12,2) AS reseller_value,
    COALESCE(SUM("unit_acquisition_cost_snapshot" * "quantity"), 0)::DECIMAL(12,2) AS acquisition_cost
  INTO totals
  FROM "pin_registration_product_snapshots"
  WHERE "pin_id" = NEW."id";
  IF totals.product_count <> NEW."registration_product_line_count_snapshot"
     OR totals.units <> NEW."registration_units_snapshot"
     OR totals.customer_payment <> NEW."registration_customer_payment_snapshot"
     OR totals.reseller_value <> NEW."registration_reseller_value_snapshot"
     OR totals.acquisition_cost <> NEW."registration_acquisition_cost_snapshot" THEN
    RAISE EXCEPTION 'Registration PIN product snapshot does not match its financial totals.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_registration_pin_after_product_snapshot"()
RETURNS TRIGGER AS $$
DECLARE
  issued RECORD;
  totals RECORD;
BEGIN
  SELECT * INTO issued FROM "pins" WHERE "id" = NEW."pin_id";
  IF NOT FOUND OR issued."pin_type" <> 'registration'
     OR issued."status" NOT IN ('unused'::"PinStatus", 'in_transit'::"PinStatus") THEN
    RAISE EXCEPTION 'Registration product snapshots belong only to a newly issued unused or in-transit registration PIN.' USING ERRCODE = '23514';
  END IF;
  SELECT
    COUNT(*)::INTEGER AS product_count,
    COALESCE(SUM("quantity"), 0)::INTEGER AS units,
    COALESCE(SUM("srp_snapshot" * "quantity"), 0)::DECIMAL(12,2) AS customer_payment,
    COALESCE(SUM("reseller_price_snapshot" * "quantity"), 0)::DECIMAL(12,2) AS reseller_value,
    COALESCE(SUM("unit_acquisition_cost_snapshot" * "quantity"), 0)::DECIMAL(12,2) AS acquisition_cost
  INTO totals
  FROM "pin_registration_product_snapshots" WHERE "pin_id" = NEW."pin_id";
  IF totals.product_count <> issued."registration_product_line_count_snapshot"
     OR totals.units <> issued."registration_units_snapshot"
     OR totals.customer_payment <> issued."registration_customer_payment_snapshot"
     OR totals.reseller_value <> issued."registration_reseller_value_snapshot"
     OR totals.acquisition_cost <> issued."registration_acquisition_cost_snapshot" THEN
    RAISE EXCEPTION 'Registration PIN product rows do not match the immutable PIN totals.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_upgrade_pin_snapshot"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."pin_type" <> 'upgrade' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT'
     AND NEW."status" NOT IN ('unused'::"PinStatus", 'in_transit'::"PinStatus") THEN
    RAISE EXCEPTION 'An Upgrade PIN must be issued unused or in transit with a complete immutable snapshot.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."status" IN ('cancelled'::"PinStatus", 'expired'::"PinStatus") THEN
    RETURN NEW;
  END IF;
  IF NOT "upgrade_pin_snapshot_is_exact"(NEW."id") THEN
    RAISE EXCEPTION 'Upgrade PIN snapshot is missing, inconsistent, underfunded, or does not match its products.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_upgrade_pin_after_product_snapshot"()
RETURNS TRIGGER AS $$
DECLARE
  issued RECORD;
BEGIN
  SELECT * INTO issued FROM "pins" WHERE "id" = NEW."pin_id";
  IF NOT FOUND OR issued."pin_type" <> 'upgrade'
     OR issued."status" NOT IN ('unused'::"PinStatus", 'in_transit'::"PinStatus")
     OR NOT "upgrade_pin_snapshot_is_exact"(NEW."pin_id") THEN
    RAISE EXCEPTION 'Upgrade product snapshots require an exact newly issued unused or in-transit Upgrade PIN.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "seal_inventory_movement_financial_identity"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Inventory-movement evidence is append-only.' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW."transfer_id", NEW."admin_id", NEW."recipient_id", NEW."product_id", NEW."order_id",
         NEW."quantity", NEW."unit_cost", NEW."unit_price", NEW."reference_value", NEW."sale_value",
         NEW."admin_profit", NEW."is_sale", NEW."admin_stock_before", NEW."admin_stock_after",
         NEW."recipient_stock_before", NEW."created_at")
     IS DISTINCT FROM
     ROW(OLD."transfer_id", OLD."admin_id", OLD."recipient_id", OLD."product_id", OLD."order_id",
         OLD."quantity", OLD."unit_cost", OLD."unit_price", OLD."reference_value", OLD."sale_value",
         OLD."admin_profit", OLD."is_sale", OLD."admin_stock_before", OLD."admin_stock_after",
         OLD."recipient_stock_before", OLD."created_at") THEN
    RAISE EXCEPTION 'Inventory-movement financial identity is immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD."received_at" IS NOT NULL AND ROW(
       NEW."recipient_stock_after", NEW."accepted_quantity", NEW."damaged_quantity",
       NEW."missing_quantity", NEW."receiving_notes", NEW."received_at"
     ) IS DISTINCT FROM ROW(
       OLD."recipient_stock_after", OLD."accepted_quantity", OLD."damaged_quantity",
       OLD."missing_quantity", OLD."receiving_notes", OLD."received_at"
     ) THEN
    RAISE EXCEPTION 'Inventory receiving evidence is immutable after receipt.' USING ERRCODE = '55000';
  END IF;
  IF OLD."received_at" IS NULL THEN
    IF NEW."received_at" IS NULL AND NEW."recipient_stock_after" IS DISTINCT FROM OLD."recipient_stock_after" THEN
      RAISE EXCEPTION 'Recipient stock cannot change before receipt is sealed.' USING ERRCODE = '23514';
    END IF;
    IF NEW."received_at" IS NOT NULL AND (
         NEW."accepted_quantity" IS NULL
         OR NEW."damaged_quantity" IS NULL
         OR NEW."missing_quantity" IS NULL
         OR NEW."accepted_quantity" < 0
         OR NEW."damaged_quantity" < 0
         OR NEW."missing_quantity" < 0
         OR NEW."accepted_quantity" + NEW."damaged_quantity" + NEW."missing_quantity" <> NEW."quantity"
         OR NEW."recipient_stock_after" < NEW."accepted_quantity"
       ) THEN
      RAISE EXCEPTION 'Receiving quantities and recipient stock evidence are inconsistent.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_movements_seal_financial_identity" ON "inventory_movements";
CREATE TRIGGER "inventory_movements_seal_financial_identity"
BEFORE UPDATE OR DELETE ON "inventory_movements"
FOR EACH ROW EXECUTE FUNCTION "seal_inventory_movement_financial_identity"();

CREATE OR REPLACE FUNCTION "protect_inventory_transfer_custody"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Inventory transfer evidence is append-only.' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'in_transit' OR NEW."dispatched_by_actor_id" IS NULL
       OR NEW."reference_value" <= 0 OR NEW."admin_id" = NEW."recipient_id" THEN
      RAISE EXCEPTION 'New inventory transfer requires an actual dispatch actor and positive reference value.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(OLD."reference_number", OLD."admin_id", OLD."dispatched_by_actor_id",
         OLD."recipient_id", OLD."reference_value", OLD."notes",
         OLD."dispatched_at", OLD."created_at")
     IS DISTINCT FROM
     ROW(NEW."reference_number", NEW."admin_id", NEW."dispatched_by_actor_id",
         NEW."recipient_id", NEW."reference_value", NEW."notes",
         NEW."dispatched_at", NEW."created_at") THEN
    RAISE EXCEPTION 'Inventory transfer dispatch identity is immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" IS DISTINCT FROM NEW."status" AND NOT (
       (OLD."status" = 'in_transit' AND NEW."status" = 'receiving')
       OR (OLD."status" = 'receiving' AND NEW."status" IN ('received_full', 'received_discrepancy', 'rejected'))
     ) THEN
    RAISE EXCEPTION 'Inventory transfer status transition is not monotonic.' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" IN ('received_full', 'received_discrepancy', 'rejected') AND (
       NEW."received_at" IS NULL OR NEW."received_by" IS NULL OR NEW."received_by_actor_id" IS NULL
     ) THEN
    RAISE EXCEPTION 'Resolved inventory transfer requires Branch owner, actual receiving actor, and time.' USING ERRCODE = '23514';
  END IF;
  IF OLD."received_at" IS NOT NULL AND ROW(
       OLD."status", OLD."received_at", OLD."received_by", OLD."received_by_actor_id", OLD."receiving_notes"
     ) IS DISTINCT FROM ROW(
       NEW."status", NEW."received_at", NEW."received_by", NEW."received_by_actor_id", NEW."receiving_notes"
     ) THEN
    RAISE EXCEPTION 'Resolved inventory transfer evidence is immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_transfers_protect_custody" ON "inventory_transfers";
CREATE TRIGGER "inventory_transfers_protect_custody"
BEFORE INSERT OR UPDATE OR DELETE ON "inventory_transfers"
FOR EACH ROW EXECUTE FUNCTION "protect_inventory_transfer_custody"();

CREATE OR REPLACE FUNCTION "protect_admin_stock_receipt"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Admin stock receipt evidence is append-only.' USING ERRCODE = '55000';
  END IF;
  IF NEW."source_type" NOT IN ('production', 'supplier_purchase', 'approved_adjustment')
     OR LENGTH(TRIM(NEW."source_reference")) < 3
     OR NEW."source_reference_key" <> UPPER(REGEXP_REPLACE(TRIM(NEW."source_reference"), '\s+', ' ', 'g'))
     OR NEW."total_units" <= 0
     OR NEW."received_by_actor_id" IS NULL THEN
    RAISE EXCEPTION 'Admin stock receipt requires valid source, reference, actor, and quantity.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "protect_admin_stock_receipt_item"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Admin stock receipt item evidence is append-only.' USING ERRCODE = '55000';
  END IF;
  IF NEW."quantity" <= 0 OR NEW."unit_cost" < 0
     OR NEW."stock_after" <> NEW."stock_before" + NEW."quantity" THEN
    RAISE EXCEPTION 'Admin stock receipt item has inconsistent stock evidence.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_admin_stock_receipt_total"()
RETURNS TRIGGER AS $$
DECLARE
  expected_total INTEGER;
  actual_total INTEGER;
BEGIN
  SELECT "total_units" INTO expected_total
  FROM "admin_stock_receipts" WHERE "id" = NEW."receipt_id" FOR UPDATE;
  SELECT COALESCE(SUM("quantity"), 0)::INTEGER INTO actual_total
  FROM "admin_stock_receipt_items" WHERE "receipt_id" = NEW."receipt_id";
  IF expected_total IS NULL OR actual_total <> expected_total THEN
    RAISE EXCEPTION 'Admin stock receipt items do not match the sealed total.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_admin_stock_receipt_header_total"()
RETURNS TRIGGER AS $$
DECLARE
  actual_total INTEGER;
BEGIN
  SELECT COALESCE(SUM("quantity"), 0)::INTEGER INTO actual_total
  FROM "admin_stock_receipt_items" WHERE "receipt_id" = NEW."id";
  IF actual_total <> NEW."total_units" THEN
    RAISE EXCEPTION 'Admin stock receipt header does not match its item quantities.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "admin_stock_receipts_append_only" ON "admin_stock_receipts";
CREATE TRIGGER "admin_stock_receipts_append_only"
BEFORE INSERT OR UPDATE OR DELETE ON "admin_stock_receipts"
FOR EACH ROW EXECUTE FUNCTION "protect_admin_stock_receipt"();

DROP TRIGGER IF EXISTS "admin_stock_receipt_items_append_only" ON "admin_stock_receipt_items";
CREATE TRIGGER "admin_stock_receipt_items_append_only"
BEFORE INSERT OR UPDATE OR DELETE ON "admin_stock_receipt_items"
FOR EACH ROW EXECUTE FUNCTION "protect_admin_stock_receipt_item"();

DROP TRIGGER IF EXISTS "admin_stock_receipts_validate_total" ON "admin_stock_receipts";
CREATE CONSTRAINT TRIGGER "admin_stock_receipts_validate_total"
AFTER INSERT ON "admin_stock_receipts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_admin_stock_receipt_header_total"();

DROP TRIGGER IF EXISTS "admin_stock_receipt_items_validate_total" ON "admin_stock_receipt_items";
CREATE CONSTRAINT TRIGGER "admin_stock_receipt_items_validate_total"
AFTER INSERT ON "admin_stock_receipt_items"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_admin_stock_receipt_total"();

COMMIT;
