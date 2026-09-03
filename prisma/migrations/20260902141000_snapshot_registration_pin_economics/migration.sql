-- Freeze registration economics when a PIN/request is issued. Redemptions may
-- no longer read mutable package/product prices to decide historical funding.

BEGIN;

DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'Hiroma financial migrations require PostgreSQL 15 or newer.';
  END IF;
END $$;

-- Prevent PIN issuance/redemption, request approval, POS intake changes, and
-- linked financial writes from racing the snapshot cutover.
LOCK TABLE
  "distributor_profiles",
  "order_items",
  "orders",
  "package_products",
  "packages",
  "pin_requests",
  "pin_upgrade_product_snapshots",
  "pins",
  "pos_registration_intakes",
  "pos_transactions",
  "products",
  "registration_financials",
  "upgrade_financials",
  "users"
IN SHARE ROW EXCLUSIVE MODE;

-- Correct legacy UUID declarations that never matched the related TEXT IDs.
-- Existing UUID values have an exact canonical text representation; no
-- historical identity is inferred or changed by this conversion.
ALTER TABLE "pins"
  ALTER COLUMN "upgrade_from_package_id" TYPE TEXT USING "upgrade_from_package_id"::text;

ALTER TABLE "upgrade_financials"
  ALTER COLUMN "upgrade_pin_id" TYPE TEXT USING "upgrade_pin_id"::text,
  ALTER COLUMN "city_dist_id" TYPE TEXT USING "city_dist_id"::text,
  ALTER COLUMN "reseller_id" TYPE TEXT USING "reseller_id"::text,
  ALTER COLUMN "from_package_id" TYPE TEXT USING "from_package_id"::text,
  ALTER COLUMN "to_package_id" TYPE TEXT USING "to_package_id"::text;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "financial_purpose" VARCHAR(24) NOT NULL DEFAULT 'commerce';
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_financial_purpose_check"
  CHECK ("financial_purpose" IN ('commerce', 'pin_sale'));

ALTER TABLE "pins"
  ADD COLUMN IF NOT EXISTS "funding_order_id" TEXT,
  ADD COLUMN IF NOT EXISTS "funding_pin_request_id" TEXT,
  ADD COLUMN IF NOT EXISTS "registration_package_name_snapshot" VARCHAR,
  ADD COLUMN IF NOT EXISTS "registration_customer_payment_snapshot" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "registration_reseller_value_snapshot" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "registration_acquisition_cost_snapshot" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "registration_acquisition_tier_snapshot" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "registration_direct_allocation_snapshot" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "registration_binary_allocation_snapshot" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "registration_points_snapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "registration_product_line_count_snapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "registration_units_snapshot" INTEGER;

ALTER TABLE "pin_requests"
  ADD COLUMN IF NOT EXISTS "registration_snapshot" JSONB;

ALTER TABLE "pos_registration_intakes"
  ADD COLUMN IF NOT EXISTS "registration_snapshot" JSONB;

ALTER TABLE "pins"
  ADD CONSTRAINT "pins_funding_order_id_fkey"
    FOREIGN KEY ("funding_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pins_funding_pin_request_id_fkey"
    FOREIGN KEY ("funding_pin_request_id") REFERENCES "pin_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "pins_funding_order_id_idx" ON "pins"("funding_order_id");
CREATE INDEX IF NOT EXISTS "pins_funding_pin_request_id_idx" ON "pins"("funding_pin_request_id");

CREATE TABLE IF NOT EXISTS "pin_registration_product_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "pin_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "srp_snapshot" DECIMAL(10,2) NOT NULL,
  "reseller_price_snapshot" DECIMAL(10,2) NOT NULL,
  "unit_acquisition_cost_snapshot" DECIMAL(10,2) NOT NULL,
  CONSTRAINT "pin_registration_product_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pin_registration_product_snapshots_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "pin_registration_product_snapshots_prices_check" CHECK (
    "srp_snapshot" > 0 AND "reseller_price_snapshot" > 0
    AND "unit_acquisition_cost_snapshot" > 0
  ),
  CONSTRAINT "pin_registration_product_snapshots_pin_id_fkey"
    FOREIGN KEY ("pin_id") REFERENCES "pins"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pin_registration_product_snapshots_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "pin_registration_product_snapshots_pin_id_product_id_key"
  ON "pin_registration_product_snapshots"("pin_id", "product_id");

-- Never infer a historical contract from today's mutable package settings.
-- This CTE is deliberately disabled: legacy unused PINs stay visibly
-- unreconciled and fail closed until an operator cancels/reissues them or an
-- independently audited remediation migration supplies authoritative values.
WITH candidate AS (
  SELECT
    p."id" AS pin_id,
    pkg."name" AS package_name,
    CASE
      WHEN owner."role"::text = 'admin' THEN 'admin'
      WHEN dp."dist_level" = 'branch' THEN 'branch'
      WHEN dp."dist_level" = 'city' THEN 'city'
      ELSE NULL
    END AS acquisition_tier,
    SUM(prod."price" * pp."quantity")::DECIMAL(12,2) AS customer_payment,
    SUM(COALESCE(NULLIF(prod."reseller_price", 0), prod."price") * pp."quantity")::DECIMAL(12,2) AS reseller_value,
    SUM(
      CASE
        WHEN owner."role"::text = 'admin' THEN prod."cost_price"
        WHEN dp."dist_level" = 'branch' THEN COALESCE(NULLIF(prod."branch_price", 0), prod."cost_price")
        ELSE COALESCE(NULLIF(prod."city_price", 0), prod."cost_price")
      END * pp."quantity"
    )::DECIMAL(12,2) AS acquisition_cost,
    pkg."price"::DECIMAL(12,2) AS configured_pin,
    pkg."direct_referral_bonus"::DECIMAL(12,2) AS direct_allocation,
    (pkg."pairing_bonus_value" * 0.5)::DECIMAL(12,2) AS binary_allocation,
    pkg."pairing_bonus_value"::INTEGER AS points
  FROM "pins" p
  JOIN "packages" pkg ON pkg."id" = p."package_id"
  JOIN "package_products" pp ON pp."package_id" = p."package_id"
  JOIN "products" prod ON prod."id" = pp."product_id"
  JOIN "users" owner ON owner."id" = p."city_dist_id"
  LEFT JOIN "distributor_profiles" dp ON dp."user_id" = owner."id"
  WHERE FALSE
    AND p."pin_type" = 'registration' AND p."status" = 'unused'::"PinStatus"
  GROUP BY p."id", pkg."name", pkg."price", pkg."direct_referral_bonus",
           pkg."pairing_bonus_value", owner."role", dp."dist_level"
), valid AS (
  SELECT *, (customer_payment - reseller_value)::DECIMAL(12,2) AS pin_allocation
  FROM candidate
  WHERE acquisition_tier IS NOT NULL
    AND points > 0
    AND configured_pin = customer_payment - reseller_value
    AND direct_allocation + binary_allocation <= configured_pin
)
UPDATE "pins" p
SET "pin_allocation_snapshot" = v.pin_allocation,
    "registration_package_name_snapshot" = v.package_name,
    "registration_customer_payment_snapshot" = v.customer_payment,
    "registration_reseller_value_snapshot" = v.reseller_value,
    "registration_acquisition_cost_snapshot" = v.acquisition_cost,
    "registration_acquisition_tier_snapshot" = v.acquisition_tier,
    "registration_direct_allocation_snapshot" = v.direct_allocation,
    "registration_binary_allocation_snapshot" = v.binary_allocation,
    "registration_points_snapshot" = v.points
FROM valid v
WHERE p."id" = v.pin_id;

INSERT INTO "pin_registration_product_snapshots" (
  "pin_id", "product_id", "quantity", "srp_snapshot",
  "reseller_price_snapshot", "unit_acquisition_cost_snapshot"
)
SELECT
  p."id", pp."product_id", pp."quantity", prod."price",
  COALESCE(NULLIF(prod."reseller_price", 0), prod."price"),
  CASE
    WHEN p."registration_acquisition_tier_snapshot" = 'admin' THEN prod."cost_price"
    WHEN p."registration_acquisition_tier_snapshot" = 'branch' THEN COALESCE(NULLIF(prod."branch_price", 0), prod."cost_price")
    ELSE COALESCE(NULLIF(prod."city_price", 0), prod."cost_price")
  END
FROM "pins" p
JOIN "package_products" pp ON pp."package_id" = p."package_id"
JOIN "products" prod ON prod."id" = pp."product_id"
WHERE p."pin_type" = 'registration'
  AND p."status" = 'unused'::"PinStatus"
  AND p."registration_points_snapshot" IS NOT NULL
ON CONFLICT ("pin_id", "product_id") DO NOTHING;

-- Pending legacy requests likewise cannot prove their original product/tier
-- contract from current tables. Leave them unsnapshotted and fail closed for
-- explicit investigation, rejection/refund, or audited remediation.
WITH request_snapshot AS (
  SELECT
    pr."id",
    pr."quantity",
    pkg."id" AS package_id,
    pkg."name" AS package_name,
    dp."dist_level" AS acquisition_tier,
    SUM(prod."price" * pp."quantity")::DECIMAL(12,2) AS customer_payment,
    SUM(COALESCE(NULLIF(prod."reseller_price", 0), prod."price") * pp."quantity")::DECIMAL(12,2) AS reseller_value,
    SUM(
      CASE WHEN dp."dist_level" = 'branch'
        THEN COALESCE(NULLIF(prod."branch_price", 0), prod."cost_price")
        ELSE COALESCE(NULLIF(prod."city_price", 0), prod."cost_price")
      END * pp."quantity"
    )::DECIMAL(12,2) AS acquisition_cost,
    pkg."price"::DECIMAL(12,2) AS pin_allocation,
    pkg."direct_referral_bonus"::DECIMAL(12,2) AS direct_allocation,
    (pkg."pairing_bonus_value" * 0.5)::DECIMAL(12,2) AS binary_allocation,
    pkg."pairing_bonus_value"::INTEGER AS points,
    jsonb_agg(jsonb_build_object(
      'product_id', pp."product_id",
      'quantity', pp."quantity",
      'srp_snapshot', prod."price",
      'reseller_price_snapshot', COALESCE(NULLIF(prod."reseller_price", 0), prod."price"),
      'unit_acquisition_cost_snapshot', CASE WHEN dp."dist_level" = 'branch'
        THEN COALESCE(NULLIF(prod."branch_price", 0), prod."cost_price")
        ELSE COALESCE(NULLIF(prod."city_price", 0), prod."cost_price") END
    ) ORDER BY pp."product_id") AS products
  FROM "pin_requests" pr
  JOIN "packages" pkg ON pkg."id" = pr."package_id"
  JOIN "package_products" pp ON pp."package_id" = pkg."id"
  JOIN "products" prod ON prod."id" = pp."product_id"
  JOIN "distributor_profiles" dp ON dp."user_id" = pr."city_dist_id"
  WHERE FALSE
    AND pr."status" = 'pending' AND pr."registration_snapshot" IS NULL
    AND dp."dist_level" IN ('city', 'branch')
  GROUP BY pr."id", pr."quantity", pkg."id", pkg."name", pkg."price",
           pkg."direct_referral_bonus", pkg."pairing_bonus_value", dp."dist_level"
), valid_request AS (
  SELECT * FROM request_snapshot
  WHERE pin_allocation = customer_payment - reseller_value
    AND direct_allocation + binary_allocation <= pin_allocation
    AND points > 0
)
UPDATE "pin_requests" pr
SET "registration_snapshot" = jsonb_build_object(
      'version', 'registration-pin-v1',
      'packageId', v.package_id,
      'packageName', v.package_name,
      'acquisitionTier', v.acquisition_tier,
      'customerPayment', v.customer_payment,
      'resellerValue', v.reseller_value,
      'acquisitionCost', v.acquisition_cost,
      'pinAllocation', v.pin_allocation,
      'directAllocation', v.direct_allocation,
      'binaryAllocation', v.binary_allocation,
      'points', v.points,
      'products', v.products
    )
FROM valid_request v
WHERE pr."id" = v."id"
  AND pr."total_amount" = v.pin_allocation * v.quantity;

CREATE OR REPLACE FUNCTION "registration_snapshot_is_valid"(
  snapshot JSONB,
  expected_package_id TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  item JSONB;
  seen_product_ids JSONB := '{}'::jsonb;
  product_id_value TEXT;
  quantity_value NUMERIC;
  srp_value NUMERIC;
  reseller_price_value NUMERIC;
  acquisition_price_value NUMERIC;
  customer_payment_value NUMERIC;
  reseller_value NUMERIC;
  acquisition_cost_value NUMERIC;
  pin_allocation_value NUMERIC;
  direct_allocation_value NUMERIC;
  binary_allocation_value NUMERIC;
  points_value NUMERIC;
  line_count_value NUMERIC;
  units_value NUMERIC;
  actual_line_count INTEGER := 0;
  actual_units NUMERIC := 0;
  actual_customer_payment NUMERIC := 0;
  actual_reseller_value NUMERIC := 0;
  actual_acquisition_cost NUMERIC := 0;
BEGIN
  IF snapshot IS NULL OR jsonb_typeof(snapshot) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  IF snapshot->>'version' IS DISTINCT FROM 'registration-pin-v1'
     OR snapshot->>'packageId' IS DISTINCT FROM expected_package_id
     OR COALESCE(length(btrim(snapshot->>'packageName')), 0) = 0
     OR snapshot->>'acquisitionTier' IS NULL
     OR snapshot->>'acquisitionTier' NOT IN ('admin', 'city', 'branch')
     OR jsonb_typeof(snapshot->'products') IS DISTINCT FROM 'array'
     OR jsonb_array_length(snapshot->'products') = 0 THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(snapshot->'customerPayment') IS DISTINCT FROM 'number'
     OR jsonb_typeof(snapshot->'resellerValue') IS DISTINCT FROM 'number'
     OR jsonb_typeof(snapshot->'acquisitionCost') IS DISTINCT FROM 'number'
     OR jsonb_typeof(snapshot->'pinAllocation') IS DISTINCT FROM 'number'
     OR jsonb_typeof(snapshot->'directAllocation') IS DISTINCT FROM 'number'
     OR jsonb_typeof(snapshot->'binaryAllocation') IS DISTINCT FROM 'number'
     OR jsonb_typeof(snapshot->'points') IS DISTINCT FROM 'number'
     OR jsonb_typeof(snapshot->'productLineCount') IS DISTINCT FROM 'number'
     OR jsonb_typeof(snapshot->'units') IS DISTINCT FROM 'number' THEN
    RETURN false;
  END IF;

  customer_payment_value := (snapshot->>'customerPayment')::NUMERIC;
  reseller_value := (snapshot->>'resellerValue')::NUMERIC;
  acquisition_cost_value := (snapshot->>'acquisitionCost')::NUMERIC;
  pin_allocation_value := (snapshot->>'pinAllocation')::NUMERIC;
  direct_allocation_value := (snapshot->>'directAllocation')::NUMERIC;
  binary_allocation_value := (snapshot->>'binaryAllocation')::NUMERIC;
  points_value := (snapshot->>'points')::NUMERIC;
  line_count_value := (snapshot->>'productLineCount')::NUMERIC;
  units_value := (snapshot->>'units')::NUMERIC;

  IF customer_payment_value <= 0 OR reseller_value <= 0 OR acquisition_cost_value <= 0
     OR pin_allocation_value < 0 OR direct_allocation_value < 0 OR binary_allocation_value < 0
     OR points_value <= 0 OR points_value <> trunc(points_value)
     OR line_count_value <= 0 OR line_count_value <> trunc(line_count_value)
     OR units_value <= 0 OR units_value <> trunc(units_value)
     OR binary_allocation_value <> points_value * 0.5
     OR direct_allocation_value + binary_allocation_value > pin_allocation_value
     OR customer_payment_value <> reseller_value + pin_allocation_value
     OR reseller_value < acquisition_cost_value THEN
    RETURN false;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'products')
  LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(item->'product_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number'
       OR jsonb_typeof(item->'srp_snapshot') IS DISTINCT FROM 'number'
       OR jsonb_typeof(item->'reseller_price_snapshot') IS DISTINCT FROM 'number'
       OR jsonb_typeof(item->'unit_acquisition_cost_snapshot') IS DISTINCT FROM 'number' THEN
      RETURN false;
    END IF;
    product_id_value := btrim(item->>'product_id');
    quantity_value := (item->>'quantity')::NUMERIC;
    srp_value := (item->>'srp_snapshot')::NUMERIC;
    reseller_price_value := (item->>'reseller_price_snapshot')::NUMERIC;
    acquisition_price_value := (item->>'unit_acquisition_cost_snapshot')::NUMERIC;
    IF length(product_id_value) = 0 OR seen_product_ids ? product_id_value
       OR quantity_value <= 0 OR quantity_value <> trunc(quantity_value)
       OR srp_value <= 0 OR reseller_price_value <= 0 OR acquisition_price_value <= 0 THEN
      RETURN false;
    END IF;
    seen_product_ids := seen_product_ids || jsonb_build_object(product_id_value, true);
    actual_line_count := actual_line_count + 1;
    actual_units := actual_units + quantity_value;
    actual_customer_payment := actual_customer_payment + (srp_value * quantity_value);
    actual_reseller_value := actual_reseller_value + (reseller_price_value * quantity_value);
    actual_acquisition_cost := actual_acquisition_cost + (acquisition_price_value * quantity_value);
  END LOOP;

  RETURN actual_line_count = line_count_value
    AND actual_units = units_value
    AND actual_customer_payment = customer_payment_value
    AND actual_reseller_value = reseller_value
    AND actual_acquisition_cost = acquisition_cost_value;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION "registration_snapshot_matches_pin"(
  snapshot JSONB,
  target_pin_id TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  issued RECORD;
  item JSONB;
  sealed_count INTEGER;
BEGIN
  SELECT * INTO issued FROM "pins" WHERE "id" = target_pin_id FOR SHARE;
  IF NOT FOUND OR issued."pin_type" <> 'registration'
     OR NOT "registration_snapshot_is_valid"(snapshot, issued."package_id") THEN
    RETURN false;
  END IF;

  IF snapshot->>'packageName' IS DISTINCT FROM issued."registration_package_name_snapshot"
     OR snapshot->>'acquisitionTier' IS DISTINCT FROM issued."registration_acquisition_tier_snapshot"
     OR (snapshot->>'customerPayment')::DECIMAL(12,2) IS DISTINCT FROM issued."registration_customer_payment_snapshot"
     OR (snapshot->>'resellerValue')::DECIMAL(12,2) IS DISTINCT FROM issued."registration_reseller_value_snapshot"
     OR (snapshot->>'acquisitionCost')::DECIMAL(12,2) IS DISTINCT FROM issued."registration_acquisition_cost_snapshot"
     OR (snapshot->>'pinAllocation')::DECIMAL(12,2) IS DISTINCT FROM issued."pin_allocation_snapshot"
     OR (snapshot->>'directAllocation')::DECIMAL(12,2) IS DISTINCT FROM issued."registration_direct_allocation_snapshot"
     OR (snapshot->>'binaryAllocation')::DECIMAL(12,2) IS DISTINCT FROM issued."registration_binary_allocation_snapshot"
     OR (snapshot->>'points')::INTEGER IS DISTINCT FROM issued."registration_points_snapshot"
     OR (snapshot->>'productLineCount')::INTEGER IS DISTINCT FROM issued."registration_product_line_count_snapshot"
     OR (snapshot->>'units')::INTEGER IS DISTINCT FROM issued."registration_units_snapshot" THEN
    RETURN false;
  END IF;

  SELECT COUNT(*)::INTEGER INTO sealed_count
  FROM "pin_registration_product_snapshots"
  WHERE "pin_id" = issued."id";
  IF sealed_count <> issued."registration_product_line_count_snapshot" THEN
    RETURN false;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'products')
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM "pin_registration_product_snapshots" sealed
      WHERE sealed."pin_id" = issued."id"
        AND sealed."product_id" = item->>'product_id'
        AND sealed."quantity" = (item->>'quantity')::INTEGER
        AND sealed."srp_snapshot" = (item->>'srp_snapshot')::DECIMAL(12,2)
        AND sealed."reseller_price_snapshot" = (item->>'reseller_price_snapshot')::DECIMAL(12,2)
        AND sealed."unit_acquisition_cost_snapshot" = (item->>'unit_acquisition_cost_snapshot')::DECIMAL(12,2)
    ) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_registration_pin_snapshot"()
RETURNS TRIGGER AS $$
DECLARE
  totals RECORD;
BEGIN
  IF NEW."pin_type" <> 'registration' THEN
    RETURN NEW;
  END IF;

  -- A registration PIN must always be issued as unused. Requiring the full
  -- snapshot on INSERT closes the direct-SQL bypass where a caller could
  -- insert an already-used PIN and skip the immutable product/economic seal.
  IF TG_OP = 'INSERT' AND NEW."status" <> 'unused'::"PinStatus" THEN
    RAISE EXCEPTION 'A registration PIN must be issued unused with a complete immutable snapshot.' USING ERRCODE = '23514';
  END IF;

  -- Cancel/expire is the only safe disposal path for pre-migration legacy
  -- PINs that intentionally were not certified from mutable present-day data.
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

DROP TRIGGER IF EXISTS "pins_validate_registration_snapshot" ON "pins";
CREATE CONSTRAINT TRIGGER "pins_validate_registration_snapshot"
AFTER INSERT OR UPDATE ON "pins"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_registration_pin_snapshot"();

CREATE OR REPLACE FUNCTION "validate_registration_pin_after_product_snapshot"()
RETURNS TRIGGER AS $$
DECLARE
  issued RECORD;
  totals RECORD;
BEGIN
  SELECT * INTO issued FROM "pins" WHERE "id" = NEW."pin_id";
  IF NOT FOUND OR issued."pin_type" <> 'registration'
     OR issued."status" <> 'unused'::"PinStatus" THEN
    RAISE EXCEPTION 'Registration product snapshots belong only to a newly issued unused registration PIN.' USING ERRCODE = '23514';
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

DROP TRIGGER IF EXISTS "pin_registration_products_validate_totals" ON "pin_registration_product_snapshots";
CREATE CONSTRAINT TRIGGER "pin_registration_products_validate_totals"
AFTER INSERT ON "pin_registration_product_snapshots"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_registration_pin_after_product_snapshot"();

CREATE OR REPLACE FUNCTION "protect_registration_snapshot_identity"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."pin_allocation_snapshot" IS DISTINCT FROM NEW."pin_allocation_snapshot"
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
       OR OLD."funding_order_id" IS DISTINCT FROM NEW."funding_order_id"
       OR OLD."funding_pin_request_id" IS DISTINCT FROM NEW."funding_pin_request_id"
       OR OLD."pin_type" IS DISTINCT FROM NEW."pin_type"
       OR OLD."upgrade_from_package_id" IS DISTINCT FROM NEW."upgrade_from_package_id"
     ) THEN
    RAISE EXCEPTION 'Issued PIN package, owner, generator, and type are immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" IS DISTINCT FROM NEW."status" AND NOT (
       OLD."status" = 'unused'::"PinStatus"
       AND NEW."status" IN ('used'::"PinStatus", 'cancelled'::"PinStatus", 'expired'::"PinStatus")
     ) THEN
    RAISE EXCEPTION 'PIN status transition is not monotonic.' USING ERRCODE = '55000';
  END IF;
  IF OLD."used_by" IS NOT NULL AND OLD."used_by" IS DISTINCT FROM NEW."used_by" THEN
    RAISE EXCEPTION 'A redeemed PIN cannot be rebound to another member.' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'used'::"PinStatus" AND (NEW."used_by" IS NULL OR NEW."used_at" IS NULL) THEN
    RAISE EXCEPTION 'A used PIN must identify its member and redemption time.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "pins_protect_registration_snapshot" ON "pins";
CREATE TRIGGER "pins_protect_registration_snapshot"
BEFORE UPDATE ON "pins"
FOR EACH ROW EXECUTE FUNCTION "protect_registration_snapshot_identity"();

DROP TRIGGER IF EXISTS "pin_registration_product_snapshots_append_only" ON "pin_registration_product_snapshots";
CREATE TRIGGER "pin_registration_product_snapshots_append_only"
BEFORE UPDATE OR DELETE ON "pin_registration_product_snapshots"
FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_change"();

CREATE OR REPLACE FUNCTION "protect_pin_request_registration_snapshot"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."registration_snapshot" IS NOT NULL
     AND OLD."registration_snapshot" IS DISTINCT FROM NEW."registration_snapshot" THEN
    RAISE EXCEPTION 'PIN request financial snapshot is immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "pin_requests_protect_registration_snapshot" ON "pin_requests";
CREATE TRIGGER "pin_requests_protect_registration_snapshot"
BEFORE UPDATE ON "pin_requests"
FOR EACH ROW EXECUTE FUNCTION "protect_pin_request_registration_snapshot"();

CREATE OR REPLACE FUNCTION "pin_has_exact_paid_source"(target_pin_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  issued RECORD;
  source_order RECORD;
  source_request RECORD;
  linked_count INTEGER;
  linked_total DECIMAL(12,2);
BEGIN
  SELECT * INTO issued FROM "pins" WHERE "id" = target_pin_id FOR SHARE;
  IF NOT FOUND OR ((issued."funding_order_id" IS NULL) = (issued."funding_pin_request_id" IS NULL)) THEN
    RETURN false;
  END IF;

  IF issued."funding_order_id" IS NOT NULL THEN
    -- An exclusive row lock serializes all PIN allocation against this one
    -- paid source, so concurrent issuances cannot each validate stale totals.
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
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_pin_paid_source"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" IN ('unused'::"PinStatus", 'used'::"PinStatus")
     AND NEW."pin_allocation_snapshot" IS NOT NULL
     AND NOT "pin_has_exact_paid_source"(NEW."id") THEN
    RAISE EXCEPTION 'PIN is not backed by exactly one fully paid issuance source.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "pins_validate_paid_source" ON "pins";
CREATE CONSTRAINT TRIGGER "pins_validate_paid_source"
AFTER INSERT OR UPDATE ON "pins"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_pin_paid_source"();

CREATE OR REPLACE FUNCTION "validate_and_protect_pin_request"()
RETURNS TRIGGER AS $$
DECLARE
  snapshot_pin DECIMAL(12,2);
BEGIN
  IF NEW."quantity" <= 0 OR NEW."quantity" > 50 OR NEW."total_amount" <= 0 THEN
    RAISE EXCEPTION 'PIN request quantity must be between 1 and 50 and total must be positive.' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" <> 'rejected'
     AND NOT "registration_snapshot_is_valid"(NEW."registration_snapshot", NEW."package_id") THEN
    RAISE EXCEPTION 'PIN request requires a complete registration snapshot.' USING ERRCODE = '23514';
  END IF;
  IF NEW."registration_snapshot" IS NOT NULL THEN
    snapshot_pin := (NEW."registration_snapshot"->>'pinAllocation')::DECIMAL(12,2);
    IF snapshot_pin <= 0 OR NEW."total_amount" <> snapshot_pin * NEW."quantity" THEN
      RAISE EXCEPTION 'PIN request total does not match its immutable snapshot.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND NEW."status" <> 'pending' THEN
    RAISE EXCEPTION 'New PIN requests must start pending.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."city_dist_id" IS DISTINCT FROM NEW."city_dist_id"
       OR OLD."package_id" IS DISTINCT FROM NEW."package_id"
       OR OLD."quantity" IS DISTINCT FROM NEW."quantity"
       OR OLD."total_amount" IS DISTINCT FROM NEW."total_amount"
       OR OLD."payment_method" IS DISTINCT FROM NEW."payment_method"
       OR OLD."payment_reference" IS DISTINCT FROM NEW."payment_reference"
       OR OLD."payment_sender_name" IS DISTINCT FROM NEW."payment_sender_name"
       OR OLD."payment_datetime" IS DISTINCT FROM NEW."payment_datetime"
       OR OLD."registration_snapshot" IS DISTINCT FROM NEW."registration_snapshot" THEN
      RAISE EXCEPTION 'PIN request economic and payment identity is immutable.' USING ERRCODE = '55000';
    END IF;
    IF OLD."status" IS DISTINCT FROM NEW."status" AND NOT (
         OLD."status" = 'pending' AND NEW."status" IN ('approved', 'rejected')
       ) THEN
      RAISE EXCEPTION 'PIN request status transition is not monotonic.' USING ERRCODE = '55000';
    END IF;
    IF OLD."payment_status" = 'paid' AND NEW."payment_status" <> 'paid' THEN
      RAISE EXCEPTION 'Paid PIN requests cannot be made unpaid.' USING ERRCODE = '55000';
    END IF;
    IF OLD."payment_status" IS DISTINCT FROM NEW."payment_status"
       AND NEW."payment_status" NOT IN ('unpaid', 'pending', 'paid') THEN
      RAISE EXCEPTION 'PIN request payment transition is invalid.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."status" = 'approved' AND NEW."payment_status" <> 'paid' THEN
    RAISE EXCEPTION 'PIN request cannot be approved before full payment.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "pin_requests_validate_and_protect" ON "pin_requests";
CREATE TRIGGER "pin_requests_validate_and_protect"
BEFORE INSERT OR UPDATE ON "pin_requests"
FOR EACH ROW EXECUTE FUNCTION "validate_and_protect_pin_request"();

CREATE OR REPLACE FUNCTION "protect_paid_pin_sale_order"()
RETURNS TRIGGER AS $$
BEGIN
  -- An ordinary commerce receipt must never be repurposed later as evidence
  -- for a PIN sale. PIN issuance creates a dedicated pin_sale order in its
  -- final paid/delivered form, so the purpose is immutable for every order.
  IF OLD."financial_purpose" IS DISTINCT FROM NEW."financial_purpose" THEN
    RAISE EXCEPTION 'Order financial purpose is immutable.' USING ERRCODE = '55000';
  END IF;

  -- Seal a dedicated PIN-sale receipt immediately, even before a PIN row is
  -- linked in the same transaction. This removes the gap where an unlinked
  -- pin_sale receipt could otherwise have its payer, payee, or amount changed.
  IF OLD."financial_purpose" = 'pin_sale' AND (
       OLD."buyer_id" IS DISTINCT FROM NEW."buyer_id"
       OR OLD."seller_id" IS DISTINCT FROM NEW."seller_id"
       OR OLD."total_amount" IS DISTINCT FROM NEW."total_amount"
       OR OLD."status" IS DISTINCT FROM NEW."status"
       OR OLD."payment_status" IS DISTINCT FROM NEW."payment_status"
       OR OLD."paid_at" IS DISTINCT FROM NEW."paid_at"
     ) THEN
    RAISE EXCEPTION 'A PIN funding order is immutable after issuance.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "orders_protect_paid_pin_sale" ON "orders";
CREATE TRIGGER "orders_protect_paid_pin_sale"
BEFORE UPDATE ON "orders"
FOR EACH ROW EXECUTE FUNCTION "protect_paid_pin_sale_order"();

CREATE OR REPLACE FUNCTION "reject_commerce_link_to_pin_sale_order"()
RETURNS TRIGGER AS $$
DECLARE
  purpose TEXT;
BEGIN
  IF NEW."order_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "financial_purpose" INTO purpose
  FROM "orders" WHERE "id" = NEW."order_id" FOR SHARE;
  IF purpose = 'pin_sale' THEN
    RAISE EXCEPTION 'A dedicated PIN-sale funding order cannot contain product or POS commerce.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "order_items_reject_pin_sale_order" ON "order_items";
CREATE TRIGGER "order_items_reject_pin_sale_order"
BEFORE INSERT OR UPDATE ON "order_items"
FOR EACH ROW EXECUTE FUNCTION "reject_commerce_link_to_pin_sale_order"();

DROP TRIGGER IF EXISTS "pos_transactions_reject_pin_sale_order" ON "pos_transactions";
CREATE TRIGGER "pos_transactions_reject_pin_sale_order"
BEFORE INSERT OR UPDATE ON "pos_transactions"
FOR EACH ROW EXECUTE FUNCTION "reject_commerce_link_to_pin_sale_order"();

CREATE OR REPLACE FUNCTION "validate_and_protect_pos_registration_snapshot"()
RETURNS TRIGGER AS $$
DECLARE
  issued RECORD;
BEGIN
  IF NEW."registration_snapshot" IS NOT NULL
     AND (
       NOT "registration_snapshot_is_valid"(NEW."registration_snapshot", NEW."package_id")
       OR (NEW."registration_snapshot"->>'customerPayment')::DECIMAL(12,2) IS DISTINCT FROM NEW."amount_snapshot"
     ) THEN
    RAISE EXCEPTION 'POS registration snapshot does not match its package/payment.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."owner_id" IS DISTINCT FROM NEW."owner_id"
       OR OLD."package_id" IS DISTINCT FROM NEW."package_id"
       OR OLD."amount_snapshot" IS DISTINCT FROM NEW."amount_snapshot"
       OR OLD."registration_snapshot" IS DISTINCT FROM NEW."registration_snapshot" THEN
      RAISE EXCEPTION 'POS registration financial identity is immutable.' USING ERRCODE = '55000';
    END IF;
    IF OLD."pin_id" IS NOT NULL AND OLD."pin_id" IS DISTINCT FROM NEW."pin_id" THEN
      RAISE EXCEPTION 'POS registration cannot be rebound to another PIN.' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF NEW."status" IN (
       'released_pending_encoding'::"PosRegistrationIntakeStatus",
       'encoding_in_progress'::"PosRegistrationIntakeStatus",
       'registration_completed'::"PosRegistrationIntakeStatus"
     ) AND NEW."registration_snapshot" IS NULL THEN
    RAISE EXCEPTION 'POS release requires an immutable registration snapshot.' USING ERRCODE = '23514';
  END IF;
  IF NEW."pin_id" IS NOT NULL THEN
    SELECT * INTO issued FROM "pins" WHERE "id" = NEW."pin_id" FOR SHARE;
    IF NOT FOUND OR issued."pin_type" <> 'registration'
       OR issued."city_dist_id" <> NEW."owner_id"
       OR issued."package_id" <> NEW."package_id"
       OR issued."registration_customer_payment_snapshot" <> NEW."amount_snapshot"
       OR NOT "registration_snapshot_matches_pin"(NEW."registration_snapshot", issued."id") THEN
      RAISE EXCEPTION 'POS registration and issued PIN economics do not match.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "pos_registration_intakes_protect_snapshot" ON "pos_registration_intakes";
CREATE TRIGGER "pos_registration_intakes_protect_snapshot"
BEFORE INSERT OR UPDATE ON "pos_registration_intakes"
FOR EACH ROW EXECUTE FUNCTION "validate_and_protect_pos_registration_snapshot"();

CREATE OR REPLACE FUNCTION "validate_registration_financial_against_pin"()
RETURNS TRIGGER AS $$
DECLARE
  issued RECORD;
  issued_units INTEGER;
BEGIN
  SELECT * INTO issued FROM "pins" WHERE "id" = NEW."pin_id" FOR SHARE;
  IF NOT FOUND OR issued."pin_type" <> 'registration'
     OR issued."status" <> 'used'::"PinStatus"
     OR issued."used_at" IS NULL
     OR issued."used_by" IS DISTINCT FROM NEW."reseller_id"
     OR NOT "pin_has_exact_paid_source"(issued."id") THEN
    RAISE EXCEPTION 'Registration financial source PIN is invalid.' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(SUM("quantity"), 0)::INTEGER INTO issued_units
  FROM "pin_registration_product_snapshots" WHERE "pin_id" = NEW."pin_id";

  IF issued."city_dist_id" <> NEW."city_dist_id"
     OR issued."package_id" <> NEW."package_id"
     OR issued."registration_package_name_snapshot" IS NULL
     OR NEW."customer_payment" <> issued."registration_customer_payment_snapshot"
     OR NEW."product_acquisition_cost" <> issued."registration_acquisition_cost_snapshot"
     OR NEW."reseller_value" <> issued."registration_reseller_value_snapshot"
     OR NEW."pin_allocation" <> issued."pin_allocation_snapshot"
     OR NEW."registration_profit" <> issued."registration_reseller_value_snapshot" - issued."registration_acquisition_cost_snapshot"
     OR NEW."package_name_snapshot" <> issued."registration_package_name_snapshot"
     OR issued_units <> issued."registration_units_snapshot"
     OR NEW."package_units_snapshot" <> issued."registration_units_snapshot"
     OR NEW."direct_referral_allocation" <> issued."registration_direct_allocation_snapshot"
     OR NEW."binary_commission_allocation" <> issued."registration_binary_allocation_snapshot"
     OR NEW."binary_points_per_pair" <> issued."registration_points_snapshot"
     OR NEW."binary_point_peso_rate" <> 0.5
     OR NEW."allocation_snapshot_source" <> 'registration'
     OR NEW."payment_status" <> 'paid'
     OR NEW."paid_at" IS NULL THEN
    RAISE EXCEPTION 'Registration financial record does not exactly match its issued PIN snapshot.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "pos_registration_intakes" WHERE "pin_id" = issued."id")
     AND NOT EXISTS (
       SELECT 1 FROM "pos_registration_intakes" intake
       WHERE intake."pin_id" = issued."id"
         AND intake."owner_id" = NEW."city_dist_id"
         AND intake."package_id" = NEW."package_id"
         AND intake."amount_snapshot" = NEW."customer_payment"
         AND intake."registration_snapshot" IS NOT NULL
         AND intake."status" IN (
           'encoding_in_progress'::"PosRegistrationIntakeStatus",
           'registration_completed'::"PosRegistrationIntakeStatus"
         )
     ) THEN
    RAISE EXCEPTION 'POS registration funding handoff is not bound to this PIN transaction.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "registration_financials_match_pin_snapshot" ON "registration_financials";
CREATE TRIGGER "registration_financials_match_pin_snapshot"
BEFORE INSERT ON "registration_financials"
FOR EACH ROW EXECUTE FUNCTION "validate_registration_financial_against_pin"();

CREATE OR REPLACE FUNCTION "validate_upgrade_financial_against_pin"()
RETURNS TRIGGER AS $$
DECLARE
  issued RECORD;
BEGIN
  SELECT * INTO issued FROM "pins" WHERE "id" = NEW."upgrade_pin_id" FOR SHARE;
  IF NOT FOUND OR issued."pin_type" <> 'upgrade'
     OR issued."status" <> 'used'::"PinStatus"
     OR issued."used_at" IS NULL
     OR issued."used_by" IS DISTINCT FROM NEW."reseller_id"
     OR NOT "pin_has_exact_paid_source"(issued."id")
     OR issued."city_dist_id" <> NEW."city_dist_id"
     OR issued."upgrade_from_package_id" <> NEW."from_package_id"
     OR issued."package_id" <> NEW."to_package_id"
     OR NEW."customer_payment" <> issued."upgrade_customer_payment_snapshot"
     OR NEW."product_acquisition_cost" <> issued."upgrade_acquisition_cost_snapshot"
     OR NEW."reseller_value" <> issued."upgrade_reseller_value_snapshot"
     OR NEW."pin_allocation" <> issued."pin_allocation_snapshot"
     OR NEW."registration_profit" <> issued."upgrade_reseller_value_snapshot" - issued."upgrade_acquisition_cost_snapshot"
     OR NEW."direct_referral_allocation" <> issued."upgrade_direct_allocation_snapshot"
     OR NEW."direct_referral_paid" <> 0
     OR NEW."direct_referral_retained" <> issued."upgrade_direct_allocation_snapshot"
     OR NEW."binary_commission_allocation" <> issued."upgrade_binary_allocation_snapshot"
     OR NEW."binary_points_difference" <> issued."upgrade_points_difference_snapshot"
     OR NEW."payment_status" <> 'paid' THEN
    RAISE EXCEPTION 'Upgrade financial record does not exactly match its paid issued PIN snapshot.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "upgrade_financials_match_pin_snapshot" ON "upgrade_financials";
CREATE TRIGGER "upgrade_financials_match_pin_snapshot"
BEFORE INSERT ON "upgrade_financials"
FOR EACH ROW EXECUTE FUNCTION "validate_upgrade_financial_against_pin"();

-- Mandatory legacy cutover gate. No current package/product setting is used to
-- certify history: only already-sealed PIN fields, child snapshots, and paid
-- source evidence qualify. IDs are listed so remediation is explicit.
DO $$
DECLARE
  unresolved_pin_count BIGINT;
  unresolved_pin_ids TEXT;
  unresolved_request_count BIGINT;
  unresolved_request_ids TEXT;
BEGIN
  WITH unresolved AS (
    SELECT p."id"
    FROM "pins" p
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::INTEGER AS line_count,
        COALESCE(SUM(s."quantity"), 0)::INTEGER AS units,
        COUNT(*) FILTER (
          WHERE s."quantity" <= 0
             OR s."srp_snapshot" <= 0
             OR s."reseller_price_snapshot" <= 0
             OR s."unit_acquisition_cost_snapshot" <= 0
        )::INTEGER AS invalid_lines,
        COALESCE(SUM(s."srp_snapshot" * s."quantity"), 0)::DECIMAL(12,2) AS customer_payment,
        COALESCE(SUM(s."reseller_price_snapshot" * s."quantity"), 0)::DECIMAL(12,2) AS reseller_value,
        COALESCE(SUM(s."unit_acquisition_cost_snapshot" * s."quantity"), 0)::DECIMAL(12,2) AS acquisition_cost
      FROM "pin_registration_product_snapshots" s
      WHERE s."pin_id" = p."id"
    ) sealed ON true
    WHERE p."pin_type" = 'registration'
      AND p."status" = 'unused'::"PinStatus"
      AND (
        p."registration_package_name_snapshot" IS NULL
        OR length(btrim(p."registration_package_name_snapshot")) = 0
        OR p."registration_customer_payment_snapshot" IS NULL
        OR p."registration_customer_payment_snapshot" <= 0
        OR p."registration_reseller_value_snapshot" IS NULL
        OR p."registration_reseller_value_snapshot" <= 0
        OR p."registration_acquisition_cost_snapshot" IS NULL
        OR p."registration_acquisition_cost_snapshot" <= 0
        OR p."registration_acquisition_tier_snapshot" IS NULL
        OR p."registration_acquisition_tier_snapshot" NOT IN ('admin', 'city', 'branch')
        OR p."registration_direct_allocation_snapshot" IS NULL
        OR p."registration_direct_allocation_snapshot" < 0
        OR p."registration_binary_allocation_snapshot" IS NULL
        OR p."registration_binary_allocation_snapshot" < 0
        OR p."registration_points_snapshot" IS NULL
        OR p."registration_points_snapshot" <= 0
        OR p."registration_product_line_count_snapshot" IS NULL
        OR p."registration_product_line_count_snapshot" <= 0
        OR p."registration_units_snapshot" IS NULL
        OR p."registration_units_snapshot" <= 0
        OR p."pin_allocation_snapshot" IS NULL
        OR p."pin_allocation_snapshot" < 0
        OR p."registration_customer_payment_snapshot"
             <> p."registration_reseller_value_snapshot" + p."pin_allocation_snapshot"
        OR p."registration_binary_allocation_snapshot" <> p."registration_points_snapshot" * 0.5
        OR p."registration_direct_allocation_snapshot" + p."registration_binary_allocation_snapshot"
             > p."pin_allocation_snapshot"
        OR p."registration_reseller_value_snapshot" < p."registration_acquisition_cost_snapshot"
        OR sealed.invalid_lines <> 0
        OR sealed.line_count <> p."registration_product_line_count_snapshot"
        OR sealed.units <> p."registration_units_snapshot"
        OR sealed.customer_payment <> p."registration_customer_payment_snapshot"
        OR sealed.reseller_value <> p."registration_reseller_value_snapshot"
        OR sealed.acquisition_cost <> p."registration_acquisition_cost_snapshot"
        OR NOT "pin_has_exact_paid_source"(p."id")
      )
  ), ordered AS (
    SELECT "id", row_number() OVER (ORDER BY "id") AS row_number FROM unresolved
  )
  SELECT COUNT(*), string_agg("id", ', ' ORDER BY "id") FILTER (WHERE row_number <= 50)
  INTO unresolved_pin_count, unresolved_pin_ids
  FROM ordered;

  WITH unresolved AS (
    SELECT pr."id"
    FROM "pin_requests" pr
    WHERE pr."status" = 'pending'
      AND NOT "registration_snapshot_is_valid"(pr."registration_snapshot", pr."package_id")
  ), ordered AS (
    SELECT "id", row_number() OVER (ORDER BY "id") AS row_number FROM unresolved
  )
  SELECT COUNT(*), string_agg("id", ', ' ORDER BY "id") FILTER (WHERE row_number <= 50)
  INTO unresolved_request_count, unresolved_request_ids
  FROM ordered;

  IF unresolved_pin_count > 0 OR unresolved_request_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Authoritative registration PIN snapshots are required before cutover.',
      DETAIL = format(
        'unresolved_unused_registration_pins=%s first_pin_ids=%s unresolved_pending_pin_requests=%s first_request_ids=%s',
        unresolved_pin_count,
        COALESCE(unresolved_pin_ids, '(none)'),
        unresolved_request_count,
        COALESCE(unresolved_request_ids, '(none)')
      ),
      HINT = 'Cancel/refund and reissue unresolved records, or apply an independently audited evidence-based remediation. Never infer history from current package prices.';
  END IF;
END $$;

COMMIT;
