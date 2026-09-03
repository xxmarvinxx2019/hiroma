-- A reseller deactivation is a financial settlement, not merely a status
-- change.  New events must atomically extinguish every unpaid member payable
-- lot, debit the exact wallet balance, record company retention, and write the
-- required audit evidence.  Older events remain explicitly visible as legacy
-- until reconciled; this migration never fabricates historical allocations.

BEGIN;

DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'Hiroma financial migrations require PostgreSQL 15 or newer.';
  END IF;
END $$;

LOCK TABLE
  "audit_logs",
  "binary_payable_lots",
  "direct_referral_reserve_lots",
  "payouts",
  "product_binary_payable_lots",
  "reseller_deactivation_events",
  "reseller_profiles",
  "users",
  "wallet_ledger_entries",
  "wallets"
IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "reseller_profiles"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN;

UPDATE "reseller_profiles" rp
SET "is_active" = (u."status" = 'active'::"UserStatus")
FROM "users" u
WHERE u."id" = rp."user_id";

ALTER TABLE "reseller_profiles"
  ALTER COLUMN "is_active" SET DEFAULT true,
  ALTER COLUMN "is_active" SET NOT NULL;

ALTER TABLE "reseller_deactivation_events"
  ADD COLUMN IF NOT EXISTS "liability_liquidation_version" VARCHAR(40);

-- Existing rows intentionally stay NULL. PostgreSQL applies this default only
-- to future rows because the column was added before the default was set.
ALTER TABLE "reseller_deactivation_events"
  ALTER COLUMN "liability_liquidation_version" SET DEFAULT 'deactivation-liability-v1';

CREATE TABLE "payable_lot_forfeitures" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "deactivation_event_id" TEXT NOT NULL,
  "source_type" VARCHAR(32) NOT NULL,
  "direct_lot_id" UUID,
  "binary_lot_id" UUID,
  "product_binary_lot_id" UUID,
  "amount" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payable_lot_forfeitures_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payable_lot_forfeitures_positive_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "payable_lot_forfeitures_exact_source_check" CHECK (
    ("source_type" = 'direct_referral' AND "direct_lot_id" IS NOT NULL AND "binary_lot_id" IS NULL AND "product_binary_lot_id" IS NULL)
    OR ("source_type" = 'binary' AND "direct_lot_id" IS NULL AND "binary_lot_id" IS NOT NULL AND "product_binary_lot_id" IS NULL)
    OR ("source_type" = 'product_binary' AND "direct_lot_id" IS NULL AND "binary_lot_id" IS NULL AND "product_binary_lot_id" IS NOT NULL)
  ),
  CONSTRAINT "payable_lot_forfeitures_event_fkey"
    FOREIGN KEY ("deactivation_event_id") REFERENCES "reseller_deactivation_events"("id") ON DELETE RESTRICT,
  CONSTRAINT "payable_lot_forfeitures_direct_lot_fkey"
    FOREIGN KEY ("direct_lot_id") REFERENCES "direct_referral_reserve_lots"("id") ON DELETE RESTRICT,
  CONSTRAINT "payable_lot_forfeitures_binary_lot_fkey"
    FOREIGN KEY ("binary_lot_id") REFERENCES "binary_payable_lots"("id") ON DELETE RESTRICT,
  CONSTRAINT "payable_lot_forfeitures_product_binary_lot_fkey"
    FOREIGN KEY ("product_binary_lot_id") REFERENCES "product_binary_payable_lots"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "payable_lot_forfeitures_direct_lot_key"
  ON "payable_lot_forfeitures"("direct_lot_id");
CREATE UNIQUE INDEX "payable_lot_forfeitures_binary_lot_key"
  ON "payable_lot_forfeitures"("binary_lot_id");
CREATE UNIQUE INDEX "payable_lot_forfeitures_product_binary_lot_key"
  ON "payable_lot_forfeitures"("product_binary_lot_id");
CREATE INDEX "payable_lot_forfeitures_event_source_idx"
  ON "payable_lot_forfeitures"("deactivation_event_id", "source_type");

CREATE OR REPLACE FUNCTION "stamp_deactivation_liability_version"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."liability_liquidation_version" := 'deactivation-liability-v1';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "reseller_deactivation_events_stamp_liability_version" ON "reseller_deactivation_events";
CREATE TRIGGER "reseller_deactivation_events_stamp_liability_version"
BEFORE INSERT ON "reseller_deactivation_events"
FOR EACH ROW EXECUTE FUNCTION "stamp_deactivation_liability_version"();

CREATE OR REPLACE FUNCTION "liquidate_deactivation_payable_lots"()
RETURNS TRIGGER AS $$
DECLARE
  reseller_role TEXT;
  reseller_status TEXT;
  processor_role TEXT;
  processor_status TEXT;
  wallet_balance DECIMAL(12,2);
  wallet_reserved DECIMAL(12,2);
  payable_total DECIMAL(12,2) := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('financial-user:' || NEW."reseller_id"));

  SELECT u."role"::text, u."status"::text
  INTO reseller_role, reseller_status
  FROM "users" u
  WHERE u."id" = NEW."reseller_id"
  FOR SHARE;

  SELECT u."role"::text, u."status"::text
  INTO processor_role, processor_status
  FROM "users" u
  WHERE u."id" = NEW."processed_by"
  FOR SHARE;

  IF reseller_role <> 'reseller' OR reseller_status <> 'inactive'
     OR processor_role <> 'admin' OR processor_status <> 'active' THEN
    RAISE EXCEPTION 'A sealed deactivation requires an inactive reseller and an active Admin processor.' USING ERRCODE = '23514';
  END IF;

  SELECT w."balance", w."reserved_balance"
  INTO wallet_balance, wallet_reserved
  FROM "wallets" w
  WHERE w."user_id" = NEW."reseller_id"
  FOR UPDATE;

  IF wallet_balance IS NULL OR wallet_reserved <> 0
     OR wallet_balance <> NEW."wallet_value" OR NEW."points_value" <> 0
     OR NEW."total_flushed" <> NEW."wallet_value" + NEW."points_value" THEN
    RAISE EXCEPTION 'Deactivation values do not match the unlocked member wallet and zero-value carryover policy.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "payouts" p
    WHERE p."user_id" = NEW."reseller_id"
      AND p."status" IN ('pending'::"PayoutStatus", 'approved'::"PayoutStatus")
  ) THEN
    RAISE EXCEPTION 'Resolve pending or approved payouts before deactivation.' USING ERRCODE = '23514';
  END IF;

  PERFORM l."id" FROM "direct_referral_reserve_lots" l
    WHERE l."user_id" = NEW."reseller_id" AND l."remaining_amount" > 0 FOR UPDATE;
  PERFORM l."id" FROM "binary_payable_lots" l
    WHERE l."user_id" = NEW."reseller_id" AND l."remaining_amount" > 0 FOR UPDATE;
  PERFORM l."id" FROM "product_binary_payable_lots" l
    WHERE l."user_id" = NEW."reseller_id" AND l."remaining_amount" > 0 FOR UPDATE;

  SELECT
    COALESCE((SELECT SUM("remaining_amount") FROM "direct_referral_reserve_lots" WHERE "user_id" = NEW."reseller_id"), 0)
    + COALESCE((SELECT SUM("remaining_amount") FROM "binary_payable_lots" WHERE "user_id" = NEW."reseller_id"), 0)
    + COALESCE((SELECT SUM("remaining_amount") FROM "product_binary_payable_lots" WHERE "user_id" = NEW."reseller_id"), 0)
  INTO payable_total;

  IF payable_total <> NEW."wallet_value" THEN
    RAISE EXCEPTION 'Wallet and payable liabilities do not reconcile; deactivation is blocked.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO "payable_lot_forfeitures" (
    "deactivation_event_id", "source_type", "direct_lot_id", "amount", "created_at"
  )
  SELECT NEW."id", 'direct_referral', l."id", l."remaining_amount", NEW."created_at"
  FROM "direct_referral_reserve_lots" l
  WHERE l."user_id" = NEW."reseller_id" AND l."remaining_amount" > 0;

  INSERT INTO "payable_lot_forfeitures" (
    "deactivation_event_id", "source_type", "binary_lot_id", "amount", "created_at"
  )
  SELECT NEW."id", 'binary', l."id", l."remaining_amount", NEW."created_at"
  FROM "binary_payable_lots" l
  WHERE l."user_id" = NEW."reseller_id" AND l."remaining_amount" > 0;

  INSERT INTO "payable_lot_forfeitures" (
    "deactivation_event_id", "source_type", "product_binary_lot_id", "amount", "created_at"
  )
  SELECT NEW."id", 'product_binary', l."id", l."remaining_amount", NEW."created_at"
  FROM "product_binary_payable_lots" l
  WHERE l."user_id" = NEW."reseller_id" AND l."remaining_amount" > 0;

  UPDATE "direct_referral_reserve_lots"
  SET "remaining_amount" = 0
  WHERE "user_id" = NEW."reseller_id" AND "remaining_amount" > 0;

  UPDATE "binary_payable_lots"
  SET "remaining_amount" = 0
  WHERE "user_id" = NEW."reseller_id" AND "remaining_amount" > 0;

  UPDATE "product_binary_payable_lots"
  SET "remaining_amount" = 0
  WHERE "user_id" = NEW."reseller_id" AND "remaining_amount" > 0;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "reseller_deactivation_events_liquidate_payables" ON "reseller_deactivation_events";
CREATE TRIGGER "reseller_deactivation_events_liquidate_payables"
AFTER INSERT ON "reseller_deactivation_events"
FOR EACH ROW EXECUTE FUNCTION "liquidate_deactivation_payable_lots"();

-- The evidence rows can only be generated from the deactivation source
-- trigger. They cannot be edited or deleted by application code.
DROP TRIGGER IF EXISTS "payable_lot_forfeitures_protected_write" ON "payable_lot_forfeitures";
CREATE TRIGGER "payable_lot_forfeitures_protected_write"
BEFORE INSERT OR UPDATE OR DELETE ON "payable_lot_forfeitures"
FOR EACH ROW EXECUTE FUNCTION "require_internal_financial_ledger_write"();

DROP TRIGGER IF EXISTS "reseller_deactivation_events_append_only" ON "reseller_deactivation_events";
CREATE TRIGGER "reseller_deactivation_events_append_only"
BEFORE UPDATE OR DELETE ON "reseller_deactivation_events"
FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_change"();

CREATE OR REPLACE FUNCTION "verify_deactivation_financial_liquidation"()
RETURNS TRIGGER AS $$
DECLARE
  ledger_count BIGINT := 0;
  ledger_amount DECIMAL(12,2) := 0;
  forfeiture_total DECIMAL(12,2) := 0;
  remaining_total DECIMAL(12,2) := 0;
  transfer_count BIGINT := 0;
  exact_transfer_count BIGINT := 0;
  audit_count BIGINT := 0;
  current_wallet_balance DECIMAL(12,2);
  current_wallet_reserved DECIMAL(12,2);
  profile_left INTEGER;
  profile_right INTEGER;
  profile_active BOOLEAN;
  current_status TEXT;
BEGIN
  IF NEW."liability_liquidation_version" IS DISTINCT FROM 'deactivation-liability-v1' THEN
    RAISE EXCEPTION 'Unknown deactivation liability liquidation version.' USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(-w."balance_delta"), 0)
  INTO ledger_count, ledger_amount
  FROM "wallet_ledger_entries" w
  WHERE w."entry_type" = 'deactivation_forfeit'
    AND w."source_kind" = 'deactivation'
    AND w."source_event_id" = NEW."id"
    AND w."user_id" = NEW."reseller_id";

  SELECT COALESCE(SUM(f."amount"), 0)
  INTO forfeiture_total
  FROM "payable_lot_forfeitures" f
  WHERE f."deactivation_event_id" = NEW."id";

  SELECT
    COALESCE((SELECT SUM("remaining_amount") FROM "direct_referral_reserve_lots" WHERE "user_id" = NEW."reseller_id"), 0)
    + COALESCE((SELECT SUM("remaining_amount") FROM "binary_payable_lots" WHERE "user_id" = NEW."reseller_id"), 0)
    + COALESCE((SELECT SUM("remaining_amount") FROM "product_binary_payable_lots" WHERE "user_id" = NEW."reseller_id"), 0)
  INTO remaining_total;

  SELECT COUNT(*), COUNT(*) FILTER (
    WHERE c."type" = 'deactivation_wallet_transfer'::"CommissionType"
      AND c."amount" = NEW."wallet_value"
      AND c."source_user_id" = NEW."reseller_id"
      AND c."is_pair_overflow" = true
  )
  INTO transfer_count, exact_transfer_count
  FROM "commissions" c
  WHERE c."source_event_kind" = 'deactivation'
    AND c."source_event_id" = NEW."id";

  SELECT COUNT(*) INTO audit_count
  FROM "audit_logs" a
  WHERE a."activity_type" = 'reseller_deactivated'
    AND a."status" = 'completed'
    AND a."metadata"->>'deactivation_event_id' = NEW."id";

  SELECT w."balance", w."reserved_balance"
  INTO current_wallet_balance, current_wallet_reserved
  FROM "wallets" w WHERE w."user_id" = NEW."reseller_id";

  SELECT COALESCE(rp."left_points", 0), COALESCE(rp."right_points", 0), rp."is_active"
  INTO profile_left, profile_right, profile_active
  FROM "reseller_profiles" rp WHERE rp."user_id" = NEW."reseller_id";

  SELECT u."status"::text INTO current_status
  FROM "users" u WHERE u."id" = NEW."reseller_id";

  IF ledger_count <> 1 OR ledger_amount <> NEW."wallet_value"
     OR forfeiture_total <> NEW."wallet_value" OR remaining_total <> 0
     OR current_wallet_balance IS DISTINCT FROM 0 OR current_wallet_reserved IS DISTINCT FROM 0
     OR profile_left IS DISTINCT FROM 0 OR profile_right IS DISTINCT FROM 0 OR profile_active IS DISTINCT FROM false
     OR current_status IS DISTINCT FROM 'inactive' OR audit_count <> 1
     OR (NEW."wallet_value" > 0 AND (transfer_count <> 1 OR exact_transfer_count <> 1))
     OR (NEW."wallet_value" = 0 AND transfer_count <> 0) THEN
    RAISE EXCEPTION 'Deactivation financial liquidation is incomplete or inconsistent.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "reseller_deactivation_events_verify_liquidation" ON "reseller_deactivation_events";
CREATE CONSTRAINT TRIGGER "reseller_deactivation_events_verify_liquidation"
AFTER INSERT ON "reseller_deactivation_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "verify_deactivation_financial_liquidation"();

-- Closing the event table alone is not enough: a future route must not be able
-- to set a reseller inactive without creating the complete settlement. Every
-- reseller status transition also keeps the profile activity flag and required
-- audit evidence synchronized at commit.
CREATE OR REPLACE FUNCTION "verify_reseller_status_transition"()
RETURNS TRIGGER AS $$
DECLARE
  profile_active BOOLEAN;
  evidence_count BIGINT := 0;
BEGIN
  IF OLD."role" <> 'reseller'::"Role"
     OR NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;

  SELECT rp."is_active" INTO profile_active
  FROM "reseller_profiles" rp
  WHERE rp."user_id" = NEW."id";

  IF profile_active IS DISTINCT FROM (NEW."status" = 'active'::"UserStatus") THEN
    RAISE EXCEPTION 'Reseller status and profile activity are inconsistent.' USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'inactive'::"UserStatus" THEN
    SELECT COUNT(*) INTO evidence_count
    FROM "reseller_deactivation_events" e
    WHERE e."reseller_id" = NEW."id"
      AND e."liability_liquidation_version" = 'deactivation-liability-v1'
      AND e."created_at" >= transaction_timestamp();
    IF evidence_count <> 1 THEN
      RAISE EXCEPTION 'Inactive reseller transition requires one sealed deactivation settlement.' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT COUNT(*) INTO evidence_count
    FROM "audit_logs" a
    WHERE a."activity_type" = 'reseller_status_changed'
      AND a."status" = 'completed'
      AND a."metadata"->>'reseller_id' = NEW."id"
      AND a."metadata"->>'to_status' = NEW."status"::text
      AND a."created_at" >= transaction_timestamp();
    IF evidence_count <> 1 THEN
      RAISE EXCEPTION 'Reseller activation or suspension requires one immutable audit event.' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "users_verify_reseller_status_transition" ON "users";
CREATE CONSTRAINT TRIGGER "users_verify_reseller_status_transition"
AFTER UPDATE OF "status" ON "users"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "verify_reseller_status_transition"();

COMMIT;
