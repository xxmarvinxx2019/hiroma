-- Complete the immutable Upgrade PIN contract. Historical Upgrade PINs are
-- intentionally not backfilled from mutable package/path/product tables:
-- an unsnapshotted legacy PIN must be cancelled and reissued.

BEGIN;

DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'Hiroma financial migrations require PostgreSQL 15 or newer.';
  END IF;
END $$;

LOCK TABLE
  "pin_upgrade_product_snapshots",
  "pins",
  "upgrade_financials"
IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "pins"
  ADD COLUMN "upgrade_product_line_count_snapshot" INTEGER,
  ADD COLUMN "upgrade_units_snapshot" INTEGER;

ALTER TABLE "pin_upgrade_product_snapshots"
  ADD COLUMN "srp_snapshot" DECIMAL(10,2),
  ADD COLUMN "reseller_price_snapshot" DECIMAL(10,2);

ALTER TABLE "pin_upgrade_product_snapshots"
  ADD CONSTRAINT "pin_upgrade_product_snapshots_sealed_prices_check"
  CHECK (
    ("srp_snapshot" IS NULL OR "srp_snapshot" > 0)
    AND ("reseller_price_snapshot" IS NULL OR "reseller_price_snapshot" > 0)
    AND (
      "unit_acquisition_cost_snapshot" IS NULL
      OR "unit_acquisition_cost_snapshot" > 0
    )
  );

CREATE OR REPLACE FUNCTION "upgrade_pin_snapshot_is_exact"(target_pin_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  issued RECORD;
  totals RECORD;
BEGIN
  SELECT * INTO issued
  FROM "pins"
  WHERE "id" = target_pin_id
  FOR SHARE;

  IF NOT FOUND OR issued."pin_type" <> 'upgrade' THEN
    RETURN false;
  END IF;

  SELECT
    COUNT(*)::INTEGER AS product_count,
    COUNT(*) FILTER (
      WHERE "quantity" <= 0
         OR "srp_snapshot" IS NULL
         OR "srp_snapshot" <= 0
         OR "reseller_price_snapshot" IS NULL
         OR "reseller_price_snapshot" <= 0
         OR "unit_acquisition_cost_snapshot" IS NULL
         OR "unit_acquisition_cost_snapshot" <= 0
    )::INTEGER AS invalid_product_count,
    COALESCE(SUM("quantity"), 0)::INTEGER AS units,
    COALESCE(SUM("srp_snapshot" * "quantity"), 0)::DECIMAL(12,2) AS customer_payment,
    COALESCE(SUM("reseller_price_snapshot" * "quantity"), 0)::DECIMAL(12,2) AS reseller_value,
    COALESCE(
      SUM("unit_acquisition_cost_snapshot" * "quantity"),
      0
    )::DECIMAL(12,2) AS acquisition_cost
  INTO totals
  FROM "pin_upgrade_product_snapshots"
  WHERE "pin_id" = issued."id";

  RETURN COALESCE(
    issued."upgrade_from_package_id" IS NOT NULL
    AND issued."upgrade_from_package_id" <> issued."package_id"
    AND issued."pin_allocation_snapshot" IS NOT NULL
    AND issued."pin_allocation_snapshot" > 0
    AND issued."upgrade_customer_payment_snapshot" IS NOT NULL
    AND issued."upgrade_customer_payment_snapshot" > 0
    AND issued."upgrade_reseller_value_snapshot" IS NOT NULL
    AND issued."upgrade_reseller_value_snapshot" > 0
    AND issued."upgrade_acquisition_cost_snapshot" IS NOT NULL
    AND issued."upgrade_acquisition_cost_snapshot" > 0
    AND issued."upgrade_acquisition_tier_snapshot" IN ('city', 'branch')
    AND issued."upgrade_direct_allocation_snapshot" IS NOT NULL
    AND issued."upgrade_direct_allocation_snapshot" >= 0
    AND issued."upgrade_binary_allocation_snapshot" IS NOT NULL
    AND issued."upgrade_binary_allocation_snapshot" > 0
    AND issued."upgrade_points_difference_snapshot" IS NOT NULL
    AND issued."upgrade_points_difference_snapshot" > 0
    AND issued."upgrade_product_line_count_snapshot" IS NOT NULL
    AND issued."upgrade_product_line_count_snapshot" > 0
    AND issued."upgrade_units_snapshot" IS NOT NULL
    AND issued."upgrade_units_snapshot" > 0
    AND issued."upgrade_customer_payment_snapshot"
      = issued."upgrade_reseller_value_snapshot" + issued."pin_allocation_snapshot"
    AND issued."upgrade_binary_allocation_snapshot"
      = issued."upgrade_points_difference_snapshot" * 0.5
    AND issued."upgrade_direct_allocation_snapshot"
      + issued."upgrade_binary_allocation_snapshot"
      <= issued."pin_allocation_snapshot"
    AND issued."upgrade_reseller_value_snapshot"
      >= issued."upgrade_acquisition_cost_snapshot"
    AND totals.invalid_product_count = 0
    AND totals.product_count = issued."upgrade_product_line_count_snapshot"
    AND totals.units = issued."upgrade_units_snapshot"
    AND totals.customer_payment = issued."upgrade_customer_payment_snapshot"
    AND totals.reseller_value = issued."upgrade_reseller_value_snapshot"
    AND totals.acquisition_cost = issued."upgrade_acquisition_cost_snapshot",
    false
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_upgrade_pin_snapshot"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."pin_type" <> 'upgrade' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW."status" <> 'unused'::"PinStatus" THEN
    RAISE EXCEPTION
      'An Upgrade PIN must be issued unused with a complete immutable snapshot.'
      USING ERRCODE = '23514';
  END IF;

  -- This is the only allowed disposition for legacy Upgrade PINs whose
  -- historical contract cannot be proved. Never certify them from current
  -- package or price configuration.
  IF TG_OP = 'UPDATE'
     AND NEW."status" IN ('cancelled'::"PinStatus", 'expired'::"PinStatus") THEN
    RETURN NEW;
  END IF;

  IF NOT "upgrade_pin_snapshot_is_exact"(NEW."id") THEN
    RAISE EXCEPTION
      'Upgrade PIN snapshot is missing, inconsistent, underfunded, or does not match its products. Cancel and reissue legacy PINs.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "pins_validate_upgrade_snapshot" ON "pins";
CREATE CONSTRAINT TRIGGER "pins_validate_upgrade_snapshot"
AFTER INSERT OR UPDATE ON "pins"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_upgrade_pin_snapshot"();

CREATE OR REPLACE FUNCTION "validate_upgrade_pin_after_product_snapshot"()
RETURNS TRIGGER AS $$
DECLARE
  issued RECORD;
BEGIN
  SELECT * INTO issued
  FROM "pins"
  WHERE "id" = NEW."pin_id";

  IF NOT FOUND
     OR issued."pin_type" <> 'upgrade'
     OR issued."status" <> 'unused'::"PinStatus" THEN
    RAISE EXCEPTION
      'Upgrade product snapshots belong only to a newly issued unused Upgrade PIN.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT "upgrade_pin_snapshot_is_exact"(NEW."pin_id") THEN
    RAISE EXCEPTION
      'Upgrade PIN product rows do not match the immutable PIN totals.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "pin_upgrade_products_validate_totals"
  ON "pin_upgrade_product_snapshots";
CREATE CONSTRAINT TRIGGER "pin_upgrade_products_validate_totals"
AFTER INSERT ON "pin_upgrade_product_snapshots"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_upgrade_pin_after_product_snapshot"();

CREATE OR REPLACE FUNCTION "protect_upgrade_snapshot_identity"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."pin_type" = 'upgrade' AND (
       OLD."pin_allocation_snapshot"
         IS DISTINCT FROM NEW."pin_allocation_snapshot"
       OR OLD."upgrade_customer_payment_snapshot"
         IS DISTINCT FROM NEW."upgrade_customer_payment_snapshot"
       OR OLD."upgrade_reseller_value_snapshot"
         IS DISTINCT FROM NEW."upgrade_reseller_value_snapshot"
       OR OLD."upgrade_acquisition_cost_snapshot"
         IS DISTINCT FROM NEW."upgrade_acquisition_cost_snapshot"
       OR OLD."upgrade_acquisition_tier_snapshot"
         IS DISTINCT FROM NEW."upgrade_acquisition_tier_snapshot"
       OR OLD."upgrade_direct_allocation_snapshot"
         IS DISTINCT FROM NEW."upgrade_direct_allocation_snapshot"
       OR OLD."upgrade_binary_allocation_snapshot"
         IS DISTINCT FROM NEW."upgrade_binary_allocation_snapshot"
       OR OLD."upgrade_points_difference_snapshot"
         IS DISTINCT FROM NEW."upgrade_points_difference_snapshot"
       OR OLD."upgrade_product_line_count_snapshot"
         IS DISTINCT FROM NEW."upgrade_product_line_count_snapshot"
       OR OLD."upgrade_units_snapshot"
         IS DISTINCT FROM NEW."upgrade_units_snapshot"
     ) THEN
    RAISE EXCEPTION 'Issued Upgrade PIN financial snapshots are immutable.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "pins_protect_upgrade_snapshot" ON "pins";
CREATE TRIGGER "pins_protect_upgrade_snapshot"
BEFORE UPDATE ON "pins"
FOR EACH ROW EXECUTE FUNCTION "protect_upgrade_snapshot_identity"();

DROP TRIGGER IF EXISTS "pin_upgrade_product_snapshots_append_only"
  ON "pin_upgrade_product_snapshots";
CREATE TRIGGER "pin_upgrade_product_snapshots_append_only"
BEFORE UPDATE OR DELETE ON "pin_upgrade_product_snapshots"
FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_change"();

CREATE OR REPLACE FUNCTION "validate_upgrade_financial_against_pin"()
RETURNS TRIGGER AS $$
DECLARE
  issued RECORD;
BEGIN
  SELECT * INTO issued
  FROM "pins"
  WHERE "id" = NEW."upgrade_pin_id"
  FOR SHARE;

  IF NOT FOUND
     OR issued."pin_type" <> 'upgrade'
     OR issued."status" <> 'used'::"PinStatus"
     OR issued."used_at" IS NULL
     OR issued."used_by" IS DISTINCT FROM NEW."reseller_id"
     OR NOT "pin_has_exact_paid_source"(issued."id")
     OR NOT "upgrade_pin_snapshot_is_exact"(issued."id")
     OR issued."city_dist_id" <> NEW."city_dist_id"
     OR issued."upgrade_from_package_id" <> NEW."from_package_id"
     OR issued."package_id" <> NEW."to_package_id"
     OR NEW."customer_payment"
       <> issued."upgrade_customer_payment_snapshot"
     OR NEW."product_acquisition_cost"
       <> issued."upgrade_acquisition_cost_snapshot"
     OR NEW."reseller_value" <> issued."upgrade_reseller_value_snapshot"
     OR NEW."pin_allocation" <> issued."pin_allocation_snapshot"
     OR NEW."customer_payment" <> NEW."reseller_value" + NEW."pin_allocation"
     OR NEW."registration_profit"
       <> issued."upgrade_reseller_value_snapshot"
          - issued."upgrade_acquisition_cost_snapshot"
     OR NEW."direct_referral_allocation"
       <> issued."upgrade_direct_allocation_snapshot"
     OR NEW."direct_referral_paid" <> 0
     OR NEW."direct_referral_retained"
       <> issued."upgrade_direct_allocation_snapshot"
     OR NEW."binary_commission_allocation"
       <> issued."upgrade_binary_allocation_snapshot"
     OR NEW."binary_commission_allocation"
       <> NEW."binary_points_difference" * 0.5
     OR NEW."binary_points_difference"
       <> issued."upgrade_points_difference_snapshot"
     OR NEW."direct_referral_retained"
          + NEW."binary_commission_allocation"
       > NEW."pin_allocation"
     OR NEW."allocation_snapshot_source" <> 'upgrade_pin_snapshot'
     OR NEW."payment_status" <> 'paid'
     OR NEW."paid_at" IS NULL THEN
    RAISE EXCEPTION
      'Upgrade financial record does not exactly match its paid sealed Upgrade PIN.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "upgrade_financials_match_pin_snapshot"
  ON "upgrade_financials";
CREATE TRIGGER "upgrade_financials_match_pin_snapshot"
BEFORE INSERT ON "upgrade_financials"
FOR EACH ROW EXECUTE FUNCTION "validate_upgrade_financial_against_pin"();

-- Legacy Upgrade PINs must arrive with their already-authoritative snapshot.
-- We deliberately do not copy today's upgrade path, products, or prices into
-- old PINs. The first 50 blocking IDs are returned for explicit remediation.
DO $$
DECLARE
  unresolved_count BIGINT;
  unresolved_ids TEXT;
BEGIN
  WITH unresolved AS (
    SELECT p."id"
    FROM "pins" p
    WHERE p."pin_type" = 'upgrade'
      AND p."status" = 'unused'::"PinStatus"
      AND (
        NOT "upgrade_pin_snapshot_is_exact"(p."id")
        OR NOT "pin_has_exact_paid_source"(p."id")
      )
  ), ordered AS (
    SELECT "id", row_number() OVER (ORDER BY "id") AS row_number FROM unresolved
  )
  SELECT COUNT(*), string_agg("id", ', ' ORDER BY "id") FILTER (WHERE row_number <= 50)
  INTO unresolved_count, unresolved_ids
  FROM ordered;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Authoritative Upgrade PIN snapshots are required before cutover.',
      DETAIL = format(
        'unresolved_unused_upgrade_pins=%s first_pin_ids=%s',
        unresolved_count,
        COALESCE(unresolved_ids, '(none)')
      ),
      HINT = 'Cancel/refund and reissue unresolved Upgrade PINs, or apply an independently audited evidence-based remediation. Never infer history from current upgrade configuration.';
  END IF;
END $$;

COMMIT;
