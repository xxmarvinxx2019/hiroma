-- Central financial safety boundary.
--
-- 1. Every new commission carries immutable source provenance.
-- 2. Every spendable wallet change is an append-only ledger entry.
-- 3. Wallet balances cannot be changed directly by application or ad-hoc SQL.
-- 4. Commission credits are applied only after exact funding evidence exists.
-- 5. Delivered reseller orders create a durable Product Binary obligation in
--    the same database transaction as delivery.

BEGIN;

DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'Hiroma financial migrations require PostgreSQL 15 or newer.';
  END IF;
END $$;

-- Hold every pre-existing source table used by the opening snapshot and the
-- runtime writers. The new ledger/job tables are transaction-private until
-- COMMIT. All names follow the shared alphabetical cutover lock order.
LOCK TABLE
  "binary_payable_lots",
  "binary_payout_consumptions",
  "binary_reserve_consumptions",
  "binary_reserve_lots",
  "commissions",
  "direct_referral_payout_consumptions",
  "direct_referral_reserve_lots",
  "inventory_movements",
  "order_items",
  "orders",
  "payouts",
  "pins",
  "product_binary_funding_consumptions",
  "product_binary_funding_lots",
  "product_binary_order_events",
  "product_binary_pair_events",
  "product_binary_payable_lots",
  "product_binary_payout_consumptions",
  "registration_financials",
  "upgrade_financials",
  "users",
  "wallets"
IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "commissions"
  ADD COLUMN IF NOT EXISTS "source_event_kind" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "source_event_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "rule_version" VARCHAR(64) NOT NULL DEFAULT 'legacy-v1';

-- Recover the structured provenance already embedded in current event keys.
UPDATE "commissions"
SET "source_event_kind" = split_part("event_key", ':', 1),
    "source_event_id" = split_part("event_key", ':', 2)
WHERE "event_key" ~ '^(registration|upgrade):[^:]+:'
  AND ("source_event_kind" IS NULL OR "source_event_id" IS NULL);

CREATE INDEX IF NOT EXISTS "commissions_source_event_idx"
  ON "commissions" ("source_event_kind", "source_event_id");

-- Fail with a precise reconciliation message instead of letting the unique
-- index fail generically. Never guess which historical payment was valid.
DO $$
DECLARE
  duplicate_sources TEXT;
BEGIN
  SELECT string_agg(duplicate."source_event_id", ', ' ORDER BY duplicate."source_event_id")
  INTO duplicate_sources
  FROM (
    SELECT "source_event_id"
    FROM "commissions"
    WHERE "type" = 'direct_referral'::"CommissionType"
      AND "is_pair_overflow" = false
      AND "source_event_kind" = 'registration'
      AND "source_event_id" IS NOT NULL
    GROUP BY "source_event_id"
    HAVING COUNT(*) > 1
    LIMIT 25
  ) duplicate;

  IF duplicate_sources IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate paid registration direct-referral events require reconciliation before financial-ledger migration: %', duplicate_sources
      USING ERRCODE = '23505';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "commissions_one_paid_direct_per_registration"
  ON "commissions" ("source_event_id")
  WHERE "type" = 'direct_referral'::"CommissionType"
    AND "is_pair_overflow" = false
    AND "source_event_kind" = 'registration';

CREATE TABLE IF NOT EXISTS "wallet_ledger_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_key" VARCHAR(255) NOT NULL,
  "user_id" TEXT NOT NULL,
  "entry_type" VARCHAR(40) NOT NULL,
  "balance_delta" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "reserved_delta" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_earned_delta" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_withdrawn_delta" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "commission_id" TEXT,
  "payout_id" TEXT,
  "source_kind" VARCHAR(40) NOT NULL,
  "source_event_id" VARCHAR(255) NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_ledger_entries_event_key_key" UNIQUE ("event_key"),
  CONSTRAINT "wallet_ledger_entries_commission_id_key" UNIQUE ("commission_id"),
  CONSTRAINT "wallet_ledger_entries_payout_type_key" UNIQUE ("payout_id", "entry_type"),
  CONSTRAINT "wallet_ledger_entries_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wallet_ledger_entries_commission_fkey" FOREIGN KEY ("commission_id") REFERENCES "commissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wallet_ledger_entries_payout_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wallet_ledger_entries_nonempty_key" CHECK (length(btrim("event_key")) > 0),
  CONSTRAINT "wallet_ledger_entries_nonempty_source" CHECK (length(btrim("source_kind")) > 0 AND length(btrim("source_event_id")) > 0)
);

CREATE INDEX IF NOT EXISTS "wallet_ledger_entries_user_created_idx"
  ON "wallet_ledger_entries" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "wallet_ledger_entries_source_idx"
  ON "wallet_ledger_entries" ("source_kind", "source_event_id");

-- Migration 20260812200000 established reserved_balance as the exact sum of
-- open payouts. Re-prove that invariant while wallets and payouts are locked;
-- otherwise per-payout reservation rows would be an unaudited inference.
DO $$
DECLARE
  unresolved_count BIGINT;
  unresolved_users TEXT;
BEGIN
  WITH expected AS (
    SELECT
      w."user_id",
      w."reserved_balance",
      COALESCE(SUM(p."amount") FILTER (
        WHERE p."status" IN ('pending'::"PayoutStatus", 'approved'::"PayoutStatus")
      ), 0)::DECIMAL(12,2) AS expected_reserved
    FROM "wallets" w
    LEFT JOIN "payouts" p ON p."user_id" = w."user_id"
    GROUP BY w."user_id", w."reserved_balance"
  ), unresolved AS (
    SELECT "user_id"
    FROM expected
    WHERE "reserved_balance" <> expected_reserved
    UNION
    SELECT p."user_id"
    FROM "payouts" p
    LEFT JOIN "wallets" w ON w."user_id" = p."user_id"
    WHERE w."id" IS NULL
  ), ordered AS (
    SELECT "user_id", row_number() OVER (ORDER BY "user_id") AS row_number
    FROM unresolved
  )
  SELECT COUNT(*), string_agg("user_id", ', ' ORDER BY "user_id")
    FILTER (WHERE row_number <= 50)
  INTO unresolved_count, unresolved_users
  FROM ordered;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Wallet reservations do not exactly prove the open payout set.',
      DETAIL = format(
        'unresolved_users=%s first_ids=%s',
        unresolved_count,
        COALESCE(unresolved_users, '(none)')
      ),
      HINT = 'Reconcile reserved_balance against every pending/approved payout before retrying; do not fabricate per-payout evidence.';
  END IF;
END $$;

-- Historical wallet amounts predate this source-of-truth ledger. Record an
-- immutable opening snapshot without re-applying the existing balances.
INSERT INTO "wallet_ledger_entries" (
  "event_key", "user_id", "entry_type", "balance_delta", "reserved_delta",
  "total_earned_delta", "total_withdrawn_delta", "source_kind",
  "source_event_id", "metadata", "created_at"
)
SELECT
  'legacy-wallet-opening:' || w."id",
  w."user_id",
  'legacy_opening_snapshot',
  w."balance",
  w."reserved_balance",
  w."total_earned",
  w."total_withdrawn",
  'migration',
  w."id",
  jsonb_build_object('reconciliation_required', true),
  CURRENT_TIMESTAMP
FROM "wallets" w
WHERE w."balance" <> 0
   OR w."reserved_balance" <> 0
   OR w."total_earned" <> 0
   OR w."total_withdrawn" <> 0
ON CONFLICT ("event_key") DO NOTHING;

-- Existing open payouts already contributed to wallets.reserved_balance before
-- this ledger existed. Record their per-payout reservation identity without
-- applying the delta again, so every later release/disbursement has lineage.
INSERT INTO "wallet_ledger_entries" (
  "event_key", "user_id", "entry_type", "balance_delta", "reserved_delta",
  "total_earned_delta", "total_withdrawn_delta", "payout_id", "source_kind",
  "source_event_id", "metadata", "created_at"
)
SELECT
  'payout-reservation:' || p."id", p."user_id", 'payout_reservation',
  0, p."amount", 0, 0, p."id", 'payout', p."id",
  jsonb_build_object('migration_backfill', true), p."requested_at"
FROM "payouts" p
WHERE p."status" IN ('pending'::"PayoutStatus", 'approved'::"PayoutStatus")
ON CONFLICT ("event_key") DO NOTHING;

-- Legacy commission amounts are already represented by the aggregate wallet
-- opening snapshot above. Bind every pre-cutover commission identity to a
-- zero-delta component marker before the wallet-apply trigger exists. The
-- unique commission_id boundary then makes replaying an old commission as a
-- fresh spendable commission_credit impossible without changing the opening
-- balance a second time.
INSERT INTO "wallet_ledger_entries" (
  "event_key", "user_id", "entry_type", "balance_delta", "reserved_delta",
  "total_earned_delta", "total_withdrawn_delta", "commission_id", "source_kind",
  "source_event_id", "metadata", "created_at"
)
SELECT
  'legacy-commission-component:' || c."id",
  c."user_id",
  'legacy_commission_component',
  0,
  0,
  0,
  0,
  c."id",
  'migration',
  c."id",
  jsonb_strip_nulls(jsonb_build_object(
    'migration_backfill', true,
    'zero_delta_replay_blocker', true,
    'legacy_event_key', c."event_key",
    'legacy_source_event_kind', c."source_event_kind",
    'legacy_source_event_id', c."source_event_id",
    'legacy_rule_version', c."rule_version",
    'legacy_commission_type', c."type"::text,
    'legacy_commission_amount', c."amount",
    'legacy_is_pair_overflow', c."is_pair_overflow"
  )),
  c."created_at"
FROM "commissions" c
ON CONFLICT ("commission_id") DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "commissions" c
    LEFT JOIN "wallet_ledger_entries" entry ON entry."commission_id" = c."id"
    WHERE entry."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Every legacy commission must have an immutable wallet-ledger identity marker before cutover.'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

-- Historical rows above preserve their authoritative event time. Every new
-- ledger timestamp is database-authored so a caller cannot backdate or
-- future-date a reservation, credit, release, or forfeiture.
CREATE OR REPLACE FUNCTION "author_wallet_ledger_timestamp"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."created_at" := transaction_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "wallet_ledger_entries_author_timestamp" ON "wallet_ledger_entries";
CREATE TRIGGER "wallet_ledger_entries_author_timestamp"
BEFORE INSERT ON "wallet_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION "author_wallet_ledger_timestamp"();

CREATE TABLE IF NOT EXISTS "product_binary_settlement_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" TEXT NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_binary_settlement_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_binary_settlement_jobs_order_id_key" UNIQUE ("order_id"),
  CONSTRAINT "product_binary_settlement_jobs_order_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "product_binary_settlement_jobs_status_check" CHECK ("status" IN ('pending', 'failed', 'completed')),
  CONSTRAINT "product_binary_settlement_jobs_attempts_check" CHECK ("attempts" >= 0)
);

CREATE INDEX IF NOT EXISTS "product_binary_settlement_jobs_due_idx"
  ON "product_binary_settlement_jobs" ("status", "next_attempt_at");

CREATE OR REPLACE FUNCTION "validate_new_commission_provenance"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."event_key" IS NULL OR length(btrim(NEW."event_key")) = 0 THEN
    RAISE EXCEPTION 'Every commission requires an idempotent event key.' USING ERRCODE = '23514';
  END IF;
  IF NEW."source_event_kind" IS NULL OR length(btrim(NEW."source_event_kind")) = 0
     OR NEW."source_event_id" IS NULL OR length(btrim(NEW."source_event_id")) = 0
     OR NEW."rule_version" IS NULL OR length(btrim(NEW."rule_version")) = 0 THEN
    RAISE EXCEPTION 'Every commission requires immutable source provenance and a rule version.' USING ERRCODE = '23514';
  END IF;
  IF NEW."amount" <= 0 THEN
    RAISE EXCEPTION 'Commission amount must be positive.' USING ERRCODE = '23514';
  END IF;
  IF NEW."is_pair_overflow" = false
     AND NEW."type" NOT IN (
       'direct_referral'::"CommissionType",
       'binary_pairing'::"CommissionType",
       'sponsor_point'::"CommissionType"
     ) THEN
    RAISE EXCEPTION 'Unsupported commission type cannot become spendable.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "commissions_validate_provenance" ON "commissions";
CREATE TRIGGER "commissions_validate_provenance"
BEFORE INSERT ON "commissions"
FOR EACH ROW EXECUTE FUNCTION "validate_new_commission_provenance"();

CREATE OR REPLACE FUNCTION "validate_financial_snapshot"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'registration_financials' THEN
    IF NEW."customer_payment" < 0 OR NEW."product_acquisition_cost" < 0
       OR NEW."reseller_value" < 0 OR NEW."pin_allocation" < 0
       OR NEW."registration_profit" < 0
       OR NEW."registration_profit" <> NEW."reseller_value" - NEW."product_acquisition_cost"
       OR NEW."customer_payment" <> NEW."reseller_value" + NEW."pin_allocation"
       OR NEW."direct_referral_allocation" < 0 OR NEW."binary_commission_allocation" < 0
       OR NEW."direct_referral_allocation" + NEW."binary_commission_allocation" > NEW."pin_allocation"
       OR NEW."binary_commission_allocation" <> NEW."binary_points_per_pair" * NEW."binary_point_peso_rate"
       OR NEW."payment_status" <> 'paid' THEN
      RAISE EXCEPTION 'Registration financial snapshot is not balanced or fully funded.' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'upgrade_financials' THEN
    IF NEW."customer_payment" < 0 OR NEW."product_acquisition_cost" < 0
       OR NEW."reseller_value" < 0 OR NEW."pin_allocation" < 0
       OR NEW."registration_profit" < 0
       OR NEW."registration_profit" <> NEW."reseller_value" - NEW."product_acquisition_cost"
       OR NEW."customer_payment" <> NEW."reseller_value" + NEW."pin_allocation"
       OR NEW."direct_referral_allocation" < 0 OR NEW."direct_referral_paid" <> 0
       OR NEW."direct_referral_retained" <> NEW."direct_referral_allocation"
       OR NEW."binary_commission_allocation" < 0
       OR NEW."direct_referral_retained" + NEW."binary_commission_allocation" > NEW."pin_allocation"
       OR NEW."binary_commission_allocation" <> NEW."binary_points_difference" * 0.5
       OR NEW."payment_status" <> 'paid' THEN
      RAISE EXCEPTION 'Upgrade financial snapshot is not balanced or fully funded.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "registration_financials_validate_snapshot" ON "registration_financials";
CREATE TRIGGER "registration_financials_validate_snapshot"
BEFORE INSERT ON "registration_financials"
FOR EACH ROW EXECUTE FUNCTION "validate_financial_snapshot"();

DROP TRIGGER IF EXISTS "upgrade_financials_validate_snapshot" ON "upgrade_financials";
CREATE TRIGGER "upgrade_financials_validate_snapshot"
BEFORE INSERT ON "upgrade_financials"
FOR EACH ROW EXECUTE FUNCTION "validate_financial_snapshot"();

-- Upgrade reserve lots now have the same single database-owned source as
-- registration reserve lots. The application must not mint them directly.
CREATE OR REPLACE FUNCTION "create_binary_reserve_lot_for_upgrade"()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "binary_reserve_lots" (
    "upgrade_financial_id", "original_amount", "remaining_amount",
    "snapshot_source", "allocated_at"
  ) VALUES (
    NEW."id", NEW."binary_commission_allocation", NEW."binary_commission_allocation",
    NEW."allocation_snapshot_source", COALESCE(NEW."paid_at", NEW."created_at")
  )
  ON CONFLICT ("upgrade_financial_id") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

INSERT INTO "binary_reserve_lots" (
  "upgrade_financial_id", "original_amount", "remaining_amount",
  "snapshot_source", "allocated_at"
)
SELECT
  uf."id", uf."binary_commission_allocation", uf."binary_commission_allocation",
  uf."allocation_snapshot_source", COALESCE(uf."paid_at", uf."created_at")
FROM "upgrade_financials" uf
ON CONFLICT ("upgrade_financial_id") DO NOTHING;

DROP TRIGGER IF EXISTS "upgrade_financials_create_binary_reserve_lot" ON "upgrade_financials";
CREATE TRIGGER "upgrade_financials_create_binary_reserve_lot"
AFTER INSERT ON "upgrade_financials"
FOR EACH ROW EXECUTE FUNCTION "create_binary_reserve_lot_for_upgrade"();

CREATE OR REPLACE FUNCTION "reject_financial_history_change"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only financial history.', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

-- These tables are immutable evidence once inserted.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'commissions',
    'registration_financials',
    'upgrade_financials',
    'binary_reserve_consumptions',
    'product_binary_funding_consumptions',
    'direct_referral_payout_consumptions',
    'binary_payout_consumptions',
    'product_binary_payout_consumptions',
    'binary_pair_events',
    'binary_settlement_events',
    'product_binary_order_events',
    'product_binary_pair_events',
    'wallet_ledger_entries'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_append_only', table_name);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_change"()',
        table_name || '_append_only', table_name
      );
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION "require_internal_financial_ledger_write"()
RETURNS TRIGGER AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION '% may only be changed by its protected source transaction.', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Lots and consumptions may only be created/consumed by their source triggers.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'binary_reserve_lots',
    'binary_reserve_consumptions',
    'direct_referral_reserve_lots',
    'direct_referral_payout_consumptions',
    'binary_payable_lots',
    'binary_payout_consumptions',
    'product_binary_payable_lots',
    'product_binary_payout_consumptions',
    'product_binary_funding_lots',
    'product_binary_funding_consumptions'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_protected_write', table_name);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION "require_internal_financial_ledger_write"()',
        table_name || '_protected_write', table_name
      );
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION "apply_wallet_ledger_entry"()
RETURNS TRIGGER AS $$
DECLARE
  commission_row "commissions"%ROWTYPE;
  payout_row "payouts"%ROWTYPE;
  recipient_role TEXT;
  recipient_status TEXT;
  funded_amount DECIMAL(12,2) := 0;
  unfunded_amount DECIMAL(12,2) := 0;
  source_available DECIMAL(12,2) := 0;
  earlier_pending DECIMAL(12,2) := 0;
  deactivation_amount DECIMAL(12,2) := 0;
  changed INTEGER := 0;
  reservation_exists BOOLEAN := false;
  reservation_release_exists BOOLEAN := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('financial-user:' || NEW."user_id"));

  SELECT u."role"::text, u."status"::text
  INTO recipient_role, recipient_status
  FROM "users" u
  WHERE u."id" = NEW."user_id"
  FOR SHARE;

  IF recipient_role IS NULL THEN
    RAISE EXCEPTION 'Wallet ledger recipient does not exist.' USING ERRCODE = '23503';
  END IF;

  IF NEW."entry_type" = 'commission_credit' THEN
    IF NEW."commission_id" IS NULL OR NEW."payout_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Commission credit requires one commission and no payout.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO commission_row FROM "commissions" WHERE "id" = NEW."commission_id" FOR SHARE;
    IF NOT FOUND OR commission_row."user_id" <> NEW."user_id"
       OR commission_row."is_pair_overflow" = true
       OR recipient_role <> 'reseller' OR recipient_status <> 'active'
       OR NEW."balance_delta" <> commission_row."amount"
       OR NEW."total_earned_delta" <> commission_row."amount"
       OR NEW."reserved_delta" <> 0 OR NEW."total_withdrawn_delta" <> 0
       OR NEW."source_kind" <> commission_row."source_event_kind"
       OR NEW."source_event_id" <> commission_row."source_event_id" THEN
      RAISE EXCEPTION 'Commission wallet credit does not match an active reseller commission.' USING ERRCODE = '23514';
    END IF;

    IF commission_row."type" = 'direct_referral'::"CommissionType" THEN
      SELECT rf."direct_referral_allocation" INTO funded_amount
      FROM "registration_financials" rf
      WHERE rf."pin_id" = commission_row."source_event_id"
        AND rf."payment_status" = 'paid'
      FOR SHARE;
      IF funded_amount IS NULL OR commission_row."source_event_kind" <> 'registration'
         OR commission_row."amount" > funded_amount THEN
        RAISE EXCEPTION 'Direct referral commission is not funded by its registration snapshot.' USING ERRCODE = '23514';
      END IF;
    ELSIF commission_row."type" = 'binary_pairing'::"CommissionType" THEN
      SELECT
        COALESCE(SUM(c."amount") FILTER (WHERE c."is_unfunded" = false), 0),
        COALESCE(SUM(c."amount") FILTER (WHERE c."is_unfunded" = true), 0)
      INTO funded_amount, unfunded_amount
      FROM "binary_reserve_consumptions" c
      WHERE c."commission_id" = commission_row."id";
      IF funded_amount <> commission_row."amount" OR unfunded_amount <> 0 THEN
        RAISE EXCEPTION 'Package Binary commission is not fully funded.' USING ERRCODE = '23514';
      END IF;
    ELSIF commission_row."type" = 'sponsor_point'::"CommissionType" THEN
      SELECT
        COALESCE(SUM(c."amount") FILTER (WHERE c."is_unfunded" = false), 0),
        COALESCE(SUM(c."amount") FILTER (WHERE c."is_unfunded" = true), 0)
      INTO funded_amount, unfunded_amount
      FROM "product_binary_funding_consumptions" c
      WHERE c."commission_id" = commission_row."id";
      IF funded_amount <> commission_row."amount" OR unfunded_amount <> 0 THEN
        RAISE EXCEPTION 'Product Binary commission is not fully funded.' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Unsupported commission cannot be credited.' USING ERRCODE = '23514';
    END IF;

  ELSIF NEW."entry_type" IN ('payout_reservation', 'payout_reservation_release', 'payout_disbursement') THEN
    IF NEW."payout_id" IS NULL OR NEW."commission_id" IS NOT NULL OR recipient_role <> 'reseller'
       OR NEW."source_kind" <> 'payout' OR NEW."source_event_id" <> NEW."payout_id" THEN
      RAISE EXCEPTION 'Payout ledger entry is invalid.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO payout_row FROM "payouts" WHERE "id" = NEW."payout_id" FOR SHARE;
    IF NOT FOUND OR payout_row."user_id" <> NEW."user_id" THEN
      RAISE EXCEPTION 'Payout ledger entry does not match its payout.' USING ERRCODE = '23514';
    END IF;

    IF NEW."entry_type" = 'payout_reservation' THEN
      SELECT
        COALESCE((SELECT SUM("remaining_amount") FROM "direct_referral_reserve_lots" WHERE "user_id" = NEW."user_id"), 0)
        + COALESCE((SELECT SUM("remaining_amount") FROM "binary_payable_lots" WHERE "user_id" = NEW."user_id"), 0)
        + COALESCE((SELECT SUM("remaining_amount") FROM "product_binary_payable_lots" WHERE "user_id" = NEW."user_id"), 0)
      INTO source_available;
      SELECT COALESCE(SUM("amount"), 0) INTO earlier_pending
      FROM "payouts"
      WHERE "user_id" = NEW."user_id" AND "status" = 'pending'::"PayoutStatus" AND "id" <> NEW."payout_id";
      IF payout_row."status" <> 'pending'::"PayoutStatus"
         OR NEW."reserved_delta" <> payout_row."amount"
         OR NEW."balance_delta" <> 0 OR NEW."total_earned_delta" <> 0 OR NEW."total_withdrawn_delta" <> 0
         OR source_available - earlier_pending < payout_row."amount" THEN
        RAISE EXCEPTION 'Payout reservation exceeds source-backed withdrawable funds.' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW."entry_type" = 'payout_reservation_release' THEN
      SELECT EXISTS (
        SELECT 1 FROM "wallet_ledger_entries"
        WHERE "payout_id" = NEW."payout_id" AND "entry_type" = 'payout_reservation'
      ) INTO reservation_exists;
      IF payout_row."status" <> 'rejected'::"PayoutStatus"
         OR reservation_exists = false
         OR NEW."reserved_delta" <> -payout_row."amount"
         OR NEW."balance_delta" <> 0 OR NEW."total_earned_delta" <> 0 OR NEW."total_withdrawn_delta" <> 0 THEN
        RAISE EXCEPTION 'Payout reservation release is invalid.' USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM "wallet_ledger_entries"
        WHERE "payout_id" = NEW."payout_id" AND "entry_type" = 'payout_reservation'
      ), EXISTS (
        SELECT 1 FROM "wallet_ledger_entries"
        WHERE "payout_id" = NEW."payout_id" AND "entry_type" = 'payout_reservation_release'
      ) INTO reservation_exists, reservation_release_exists;
      IF payout_row."status" <> 'released'::"PayoutStatus"
         OR reservation_exists = false OR reservation_release_exists = true
         OR NEW."balance_delta" <> -payout_row."amount"
         OR NEW."reserved_delta" <> -payout_row."amount"
         OR NEW."total_earned_delta" <> 0
         OR NEW."total_withdrawn_delta" <> payout_row."amount" THEN
        RAISE EXCEPTION 'Payout disbursement is invalid.' USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF NEW."entry_type" = 'deactivation_forfeit' THEN
    SELECT e."wallet_value" INTO deactivation_amount
    FROM "reseller_deactivation_events" e
    WHERE e."id" = NEW."source_event_id" AND e."reseller_id" = NEW."user_id"
    FOR SHARE;
    IF deactivation_amount IS NULL OR recipient_role <> 'reseller' OR recipient_status <> 'inactive'
       OR NEW."balance_delta" <> -deactivation_amount
       OR NEW."reserved_delta" <> 0 OR NEW."total_earned_delta" <> 0 OR NEW."total_withdrawn_delta" <> 0 THEN
      RAISE EXCEPTION 'Deactivation wallet forfeiture is invalid.' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported wallet ledger entry type.' USING ERRCODE = '23514';
  END IF;

  UPDATE "wallets"
  SET "balance" = "balance" + NEW."balance_delta",
      "reserved_balance" = "reserved_balance" + NEW."reserved_delta",
      "total_earned" = "total_earned" + NEW."total_earned_delta",
      "total_withdrawn" = "total_withdrawn" + NEW."total_withdrawn_delta",
      "updated_at" = CURRENT_TIMESTAMP
  WHERE "user_id" = NEW."user_id"
    AND "balance" + NEW."balance_delta" >= 0
    AND "reserved_balance" + NEW."reserved_delta" >= 0
    AND "balance" + NEW."balance_delta" >= "reserved_balance" + NEW."reserved_delta"
    AND "total_earned" + NEW."total_earned_delta" >= 0
    AND "total_withdrawn" + NEW."total_withdrawn_delta" >= 0;
  GET DIAGNOSTICS changed = ROW_COUNT;

  IF changed <> 1 THEN
    RAISE EXCEPTION 'Wallet ledger delta violates wallet balance invariants.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "wallet_ledger_entries_apply" ON "wallet_ledger_entries";
CREATE TRIGGER "wallet_ledger_entries_apply"
AFTER INSERT ON "wallet_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION "apply_wallet_ledger_entry"();

CREATE OR REPLACE FUNCTION "apply_commission_wallet_credit"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."is_pair_overflow" = false THEN
    INSERT INTO "wallet_ledger_entries" (
      "event_key", "user_id", "entry_type", "balance_delta", "reserved_delta",
      "total_earned_delta", "total_withdrawn_delta", "commission_id",
      "source_kind", "source_event_id", "metadata", "created_at"
    ) VALUES (
      'commission-credit:' || NEW."event_key", NEW."user_id", 'commission_credit',
      NEW."amount", 0, NEW."amount", 0, NEW."id",
      NEW."source_event_kind", NEW."source_event_id",
      jsonb_build_object('commission_type', NEW."type"::text, 'rule_version', NEW."rule_version"),
      NEW."created_at"
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Same-event PostgreSQL triggers run by name. This must follow all existing
-- reserve/funding and payable-lot triggers on commissions.
DROP TRIGGER IF EXISTS "zzzzzz_commissions_apply_wallet_credit" ON "commissions";
CREATE TRIGGER "zzzzzz_commissions_apply_wallet_credit"
AFTER INSERT ON "commissions"
FOR EACH ROW EXECUTE FUNCTION "apply_commission_wallet_credit"();

CREATE OR REPLACE FUNCTION "protect_wallet_balances"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Wallets cannot be deleted; use the immutable ledger.' USING ERRCODE = '55000';
  END IF;
  IF pg_trigger_depth() <= 1 THEN
    IF TG_OP = 'INSERT' AND (
      NEW."balance" <> 0 OR NEW."reserved_balance" <> 0
      OR NEW."total_earned" <> 0 OR NEW."total_withdrawn" <> 0
    ) THEN
      RAISE EXCEPTION 'Non-zero wallets must be created by the immutable ledger.' USING ERRCODE = '55000';
    ELSIF TG_OP = 'UPDATE' AND (
      NEW."balance" IS DISTINCT FROM OLD."balance"
      OR NEW."reserved_balance" IS DISTINCT FROM OLD."reserved_balance"
      OR NEW."total_earned" IS DISTINCT FROM OLD."total_earned"
      OR NEW."total_withdrawn" IS DISTINCT FROM OLD."total_withdrawn"
    ) THEN
      RAISE EXCEPTION 'Wallet balances may only be changed by the immutable ledger.' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "wallets_protect_balances" ON "wallets";
CREATE TRIGGER "wallets_protect_balances"
BEFORE INSERT OR UPDATE OR DELETE ON "wallets"
FOR EACH ROW EXECUTE FUNCTION "protect_wallet_balances"();

CREATE OR REPLACE FUNCTION "enqueue_product_binary_settlement"()
RETURNS TRIGGER AS $$
DECLARE
  buyer_role TEXT;
BEGIN
  IF NEW."status" = 'delivered'::"OrderStatus"
     AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM NEW."status") THEN
    SELECT "role"::text INTO buyer_role FROM "users" WHERE "id" = NEW."buyer_id" FOR SHARE;
    IF buyer_role = 'reseller' THEN
      INSERT INTO "product_binary_settlement_jobs" ("order_id")
      VALUES (NEW."id")
      ON CONFLICT ("order_id") DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "orders_enqueue_product_binary_settlement" ON "orders";
CREATE TRIGGER "orders_enqueue_product_binary_settlement"
AFTER INSERT OR UPDATE OF "status" ON "orders"
FOR EACH ROW EXECUTE FUNCTION "enqueue_product_binary_settlement"();

INSERT INTO "product_binary_settlement_jobs" ("order_id")
SELECT o."id"
FROM "orders" o
JOIN "users" u ON u."id" = o."buyer_id"
LEFT JOIN "product_binary_order_events" e ON e."order_id" = o."id"
WHERE o."status" = 'delivered'::"OrderStatus"
  AND u."role" = 'reseller'::"Role"
  AND e."id" IS NULL
ON CONFLICT ("order_id") DO NOTHING;

CREATE OR REPLACE FUNCTION "protect_product_binary_job_identity"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Product Binary settlement obligations cannot be deleted.' USING ERRCODE = '55000';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."order_id" IS DISTINCT FROM OLD."order_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Product Binary settlement obligation identity is immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'completed' AND NEW."status" <> 'completed' THEN
    RAISE EXCEPTION 'Completed Product Binary settlement cannot be reopened.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "product_binary_jobs_protect_identity" ON "product_binary_settlement_jobs";
CREATE TRIGGER "product_binary_jobs_protect_identity"
BEFORE UPDATE OR DELETE ON "product_binary_settlement_jobs"
FOR EACH ROW EXECUTE FUNCTION "protect_product_binary_job_identity"();

-- Reconciliation view: any non-zero unexplained balance is visible to Admin
-- and must be resolved before it can be paid out.
CREATE OR REPLACE VIEW "wallet_funding_reconciliation" AS
SELECT
  w."user_id",
  w."balance",
  w."reserved_balance",
  COALESCE(d."amount", 0) + COALESCE(b."amount", 0) + COALESCE(pb."amount", 0)
    + COALESCE(ap."amount", 0) AS "source_backed_liability",
  w."balance" - (
    COALESCE(d."amount", 0) + COALESCE(b."amount", 0) + COALESCE(pb."amount", 0)
    + COALESCE(ap."amount", 0)
  ) AS "unreconciled_balance"
FROM "wallets" w
LEFT JOIN (
  SELECT "user_id", SUM("remaining_amount") AS amount
  FROM "direct_referral_reserve_lots" GROUP BY "user_id"
) d ON d."user_id" = w."user_id"
LEFT JOIN (
  SELECT "user_id", SUM("remaining_amount") AS amount
  FROM "binary_payable_lots" GROUP BY "user_id"
) b ON b."user_id" = w."user_id"
LEFT JOIN (
  SELECT "user_id", SUM("remaining_amount") AS amount
  FROM "product_binary_payable_lots" GROUP BY "user_id"
) pb ON pb."user_id" = w."user_id"
LEFT JOIN (
  SELECT "user_id", SUM("amount") AS amount
  FROM "payouts" WHERE "status" = 'approved'::"PayoutStatus" GROUP BY "user_id"
) ap ON ap."user_id" = w."user_id";

COMMIT;
