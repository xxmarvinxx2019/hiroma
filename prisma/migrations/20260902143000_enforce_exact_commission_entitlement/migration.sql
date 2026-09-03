-- A reserve balance proves that money exists; it does not prove who earned it.
-- Bind every future spendable commission to its exact immutable sponsor/pair
-- event before the surrounding transaction may commit.

BEGIN;

-- Keep the cutover atomic and stop a registration, upgrade, or Product Binary
-- worker from crossing the historical preflight/new-trigger boundary. Acquire
-- every write-sensitive relation in one fixed lexical order so concurrent
-- migrations and workers cannot invert the table-lock order.
LOCK TABLE
  "binary_pair_events",
  "binary_settlement_events",
  "commissions",
  "product_binary_order_events",
  "product_binary_pair_events",
  "product_binary_positions",
  "product_binary_settlement_jobs",
  "registration_financials",
  "upgrade_financials"
IN SHARE ROW EXCLUSIVE MODE;

-- Historical Package Binary events did not preserve their opening/closing
-- carryover. Keep those rows explicitly NULL instead of inventing history;
-- the INSERT trigger below requires complete snapshots for every new event.
ALTER TABLE "binary_pair_events"
  ADD COLUMN IF NOT EXISTS "opening_left_points" INTEGER,
  ADD COLUMN IF NOT EXISTS "opening_right_points" INTEGER,
  ADD COLUMN IF NOT EXISTS "closing_left_points" INTEGER,
  ADD COLUMN IF NOT EXISTS "closing_right_points" INTEGER,
  ADD COLUMN IF NOT EXISTS "pairing_day" DATE,
  ADD COLUMN IF NOT EXISTS "opening_daily_pairing_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "closing_daily_pairing_count" INTEGER;

ALTER TABLE "binary_pair_events"
  DROP CONSTRAINT IF EXISTS "binary_pair_events_state_snapshot_check";

ALTER TABLE "binary_pair_events"
  ADD CONSTRAINT "binary_pair_events_state_snapshot_check" CHECK (
    (
      "opening_left_points" IS NULL
      AND "opening_right_points" IS NULL
      AND "closing_left_points" IS NULL
      AND "closing_right_points" IS NULL
      AND "pairing_day" IS NULL
      AND "opening_daily_pairing_count" IS NULL
      AND "closing_daily_pairing_count" IS NULL
    )
    OR
    (
      "opening_left_points" IS NOT NULL
      AND "opening_right_points" IS NOT NULL
      AND "closing_left_points" IS NOT NULL
      AND "closing_right_points" IS NOT NULL
      AND "pairing_day" IS NOT NULL
      AND "opening_daily_pairing_count" IS NOT NULL
      AND "closing_daily_pairing_count" IS NOT NULL
      AND "opening_left_points" >= 0
      AND "opening_right_points" >= 0
      AND "closing_left_points" >= 0
      AND "closing_right_points" >= 0
      AND "opening_daily_pairing_count" >= 0
      AND "closing_daily_pairing_count" >= 0
    )
  );

-- Product Binary already preserved point carryover, but its historical rows
-- did not snapshot lifetime counters. Future events must preserve all six so
-- a later order cannot reuse state that an event claimed to consume.
ALTER TABLE "product_binary_pair_events"
  ADD COLUMN IF NOT EXISTS "opening_lifetime_pairs" INTEGER,
  ADD COLUMN IF NOT EXISTS "opening_lifetime_payable" INTEGER,
  ADD COLUMN IF NOT EXISTS "opening_lifetime_flashout" INTEGER,
  ADD COLUMN IF NOT EXISTS "closing_lifetime_pairs" INTEGER,
  ADD COLUMN IF NOT EXISTS "closing_lifetime_payable" INTEGER,
  ADD COLUMN IF NOT EXISTS "closing_lifetime_flashout" INTEGER;

ALTER TABLE "product_binary_pair_events"
  DROP CONSTRAINT IF EXISTS "product_binary_pair_events_lifetime_snapshot_check";

ALTER TABLE "product_binary_pair_events"
  ADD CONSTRAINT "product_binary_pair_events_lifetime_snapshot_check" CHECK (
    (
      "opening_lifetime_pairs" IS NULL
      AND "opening_lifetime_payable" IS NULL
      AND "opening_lifetime_flashout" IS NULL
      AND "closing_lifetime_pairs" IS NULL
      AND "closing_lifetime_payable" IS NULL
      AND "closing_lifetime_flashout" IS NULL
    )
    OR
    (
      "opening_lifetime_pairs" IS NOT NULL
      AND "opening_lifetime_payable" IS NOT NULL
      AND "opening_lifetime_flashout" IS NOT NULL
      AND "closing_lifetime_pairs" IS NOT NULL
      AND "closing_lifetime_payable" IS NOT NULL
      AND "closing_lifetime_flashout" IS NOT NULL
      AND "opening_lifetime_pairs" >= 0
      AND "opening_lifetime_payable" >= 0
      AND "opening_lifetime_flashout" >= 0
      AND "closing_lifetime_pairs" >= 0
      AND "closing_lifetime_payable" >= 0
      AND "closing_lifetime_flashout" >= 0
    )
  );

-- Fail with a reconciliation-specific error before adding unique indexes. An
-- existing commission cannot safely be assigned to one of multiple events by
-- a migration because that would invent historical entitlement.
DO $$
DECLARE
  duplicate_direct_flashout TEXT;
  duplicate_package_binary TEXT;
  duplicate_package_flashout TEXT;
  duplicate_product_binary TEXT;
  duplicate_product_flashout TEXT;
BEGIN
  SELECT string_agg(duplicate."source_event_id", ', ' ORDER BY duplicate."source_event_id")
  INTO duplicate_direct_flashout
  FROM (
    SELECT "source_event_id"
    FROM "commissions"
    WHERE "type" = 'direct_referral'::"CommissionType"
      AND "is_pair_overflow" = true
      AND "source_event_kind" = 'registration'
      AND "source_event_id" IS NOT NULL
    GROUP BY "source_event_id"
    HAVING COUNT(*) > 1
    ORDER BY "source_event_id"
    LIMIT 25
  ) duplicate;

  IF duplicate_direct_flashout IS NOT NULL THEN
    RAISE EXCEPTION
      'Duplicate retained Direct Referral commission sources require reconciliation before exact-entitlement migration: %',
      duplicate_direct_flashout
      USING ERRCODE = '23505';
  END IF;

  SELECT string_agg(duplicate."normal_commission_id", ', ' ORDER BY duplicate."normal_commission_id")
  INTO duplicate_package_binary
  FROM (
    SELECT "normal_commission_id"
    FROM "binary_pair_events"
    WHERE "normal_commission_id" IS NOT NULL
    GROUP BY "normal_commission_id"
    HAVING COUNT(*) > 1
    ORDER BY "normal_commission_id"
    LIMIT 25
  ) duplicate;

  IF duplicate_package_binary IS NOT NULL THEN
    RAISE EXCEPTION
      'Duplicate Package Binary commission-to-pair links require reconciliation before exact-entitlement migration: %',
      duplicate_package_binary
      USING ERRCODE = '23505';
  END IF;

  SELECT string_agg(duplicate."flashout_commission_id", ', ' ORDER BY duplicate."flashout_commission_id")
  INTO duplicate_package_flashout
  FROM (
    SELECT "flashout_commission_id"
    FROM "binary_pair_events"
    WHERE "flashout_commission_id" IS NOT NULL
    GROUP BY "flashout_commission_id"
    HAVING COUNT(*) > 1
    ORDER BY "flashout_commission_id"
    LIMIT 25
  ) duplicate;

  IF duplicate_package_flashout IS NOT NULL THEN
    RAISE EXCEPTION
      'Duplicate Package Binary retained-commission-to-pair links require reconciliation before exact-entitlement migration: %',
      duplicate_package_flashout
      USING ERRCODE = '23505';
  END IF;

  SELECT string_agg(duplicate."normal_commission_id", ', ' ORDER BY duplicate."normal_commission_id")
  INTO duplicate_product_binary
  FROM (
    SELECT "normal_commission_id"
    FROM "product_binary_pair_events"
    WHERE "normal_commission_id" IS NOT NULL
    GROUP BY "normal_commission_id"
    HAVING COUNT(*) > 1
    ORDER BY "normal_commission_id"
    LIMIT 25
  ) duplicate;

  IF duplicate_product_binary IS NOT NULL THEN
    RAISE EXCEPTION
      'Duplicate Product Binary commission-to-pair links require reconciliation before exact-entitlement migration: %',
      duplicate_product_binary
      USING ERRCODE = '23505';
  END IF;

  SELECT string_agg(duplicate."flashout_commission_id", ', ' ORDER BY duplicate."flashout_commission_id")
  INTO duplicate_product_flashout
  FROM (
    SELECT "flashout_commission_id"
    FROM "product_binary_pair_events"
    WHERE "flashout_commission_id" IS NOT NULL
    GROUP BY "flashout_commission_id"
    HAVING COUNT(*) > 1
    ORDER BY "flashout_commission_id"
    LIMIT 25
  ) duplicate;

  IF duplicate_product_flashout IS NOT NULL THEN
    RAISE EXCEPTION
      'Duplicate Product Binary retained-commission-to-pair links require reconciliation before exact-entitlement migration: %',
      duplicate_product_flashout
      USING ERRCODE = '23505';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "commissions_one_retained_direct_per_registration"
  ON "commissions" ("source_event_id")
  WHERE "type" = 'direct_referral'::"CommissionType"
    AND "is_pair_overflow" = true
    AND "source_event_kind" = 'registration';

CREATE UNIQUE INDEX IF NOT EXISTS "binary_pair_events_normal_commission_id_key"
  ON "binary_pair_events" ("normal_commission_id")
  WHERE "normal_commission_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "binary_pair_events_flashout_commission_id_key"
  ON "binary_pair_events" ("flashout_commission_id")
  WHERE "flashout_commission_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "product_binary_pair_events_normal_commission_id_key"
  ON "product_binary_pair_events" ("normal_commission_id")
  WHERE "normal_commission_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "product_binary_pair_events_flashout_commission_id_key"
  ON "product_binary_pair_events" ("flashout_commission_id")
  WHERE "flashout_commission_id" IS NOT NULL;

-- Do not silently bless historical pair links merely because their foreign
-- keys exist. Modern rule-version commissions must already have exactly the
-- same recipient, source, points, and amount as the immutable pair evidence.
-- Rows sealed as legacy-v1 remain append-only historical evidence: they predate
-- source-event/state snapshots and must not be relabelled as modern rules.
DO $$
DECLARE
  invalid_package_entitlements TEXT;
  invalid_product_entitlements TEXT;
BEGIN
  SELECT string_agg(invalid."issue_key", ', ' ORDER BY invalid."issue_key")
  INTO invalid_package_entitlements
  FROM (
    SELECT 'pair:' || event."id"::text AS "issue_key"
    FROM "binary_pair_events" event
    LEFT JOIN "commissions" normal
      ON normal."id" = event."normal_commission_id"
    LEFT JOIN "commissions" flashout
      ON flashout."id" = event."flashout_commission_id"
    WHERE (event."payable_amount" > 0) IS DISTINCT FROM (event."normal_commission_id" IS NOT NULL)
       OR (event."flashout_amount" > 0) IS DISTINCT FROM (event."flashout_commission_id" IS NOT NULL)
       OR (event."normal_commission_id" IS NOT NULL
           AND normal."rule_version" IS DISTINCT FROM 'legacy-v1'
           AND (
            normal."type" IS DISTINCT FROM 'binary_pairing'::"CommissionType"
         OR normal."rule_version" IS DISTINCT FROM 'package-binary-v1'
         OR normal."is_pair_overflow" IS DISTINCT FROM false
         OR normal."user_id" IS DISTINCT FROM event."recipient_user_id"
         OR normal."source_user_id" IS DISTINCT FROM event."source_user_id"
         OR normal."source_event_kind" IS DISTINCT FROM event."source_kind"
         OR normal."source_event_id" IS DISTINCT FROM event."source_event_id"
         OR normal."amount" IS DISTINCT FROM event."payable_amount"
         OR normal."points"::NUMERIC IS DISTINCT FROM event."payable_pairs" * event."points_per_pair"
       ))
       OR (event."flashout_commission_id" IS NOT NULL
           AND flashout."rule_version" IS DISTINCT FROM 'legacy-v1'
           AND (
            flashout."type" IS DISTINCT FROM 'binary_pairing'::"CommissionType"
         OR flashout."rule_version" IS DISTINCT FROM 'package-binary-v1'
         OR flashout."is_pair_overflow" IS DISTINCT FROM true
         OR flashout."source_user_id" IS DISTINCT FROM event."source_user_id"
         OR flashout."source_event_kind" IS DISTINCT FROM event."source_kind"
         OR flashout."source_event_id" IS DISTINCT FROM event."source_event_id"
         OR flashout."amount" IS DISTINCT FROM event."flashout_amount"
         OR flashout."points"::NUMERIC IS DISTINCT FROM
              (event."cap_flashout_pairs" + event."inactive_flashout_pairs") * event."points_per_pair"
         OR flashout."overflow_to" IS DISTINCT FROM flashout."user_id"
         OR NOT EXISTS (
              SELECT 1 FROM "users" hiroma
              WHERE hiroma."id" = flashout."user_id"
                AND hiroma."username" = 'hiroma'
                AND hiroma."role" = 'admin'::"Role"
            )
       ))

    UNION ALL

    SELECT 'commission:' || commission."id" AS "issue_key"
    FROM "commissions" commission
    WHERE commission."type" = 'binary_pairing'::"CommissionType"
      AND commission."rule_version" = 'package-binary-v1'
      AND (
        (commission."is_pair_overflow" = false AND NOT EXISTS (
          SELECT 1 FROM "binary_pair_events" event
          WHERE event."normal_commission_id" = commission."id"
        ))
        OR
        (commission."is_pair_overflow" = true AND NOT EXISTS (
          SELECT 1 FROM "binary_pair_events" event
          WHERE event."flashout_commission_id" = commission."id"
        ))
      )
    ORDER BY "issue_key"
    LIMIT 25
  ) invalid;

  IF invalid_package_entitlements IS NOT NULL THEN
    RAISE EXCEPTION
      'Historical Package Binary commission entitlement requires reconciliation before exact-entitlement migration: %',
      invalid_package_entitlements
      USING ERRCODE = '23514';
  END IF;

  SELECT string_agg(invalid."issue_key", ', ' ORDER BY invalid."issue_key")
  INTO invalid_product_entitlements
  FROM (
    SELECT 'pair:' || pair_event."id"::text AS "issue_key"
    FROM "product_binary_pair_events" pair_event
    JOIN "product_binary_order_events" order_event
      ON order_event."id" = pair_event."order_event_id"
    LEFT JOIN "commissions" normal
      ON normal."id" = pair_event."normal_commission_id"
    LEFT JOIN "commissions" flashout
      ON flashout."id" = pair_event."flashout_commission_id"
    WHERE (pair_event."payable_amount" > 0) IS DISTINCT FROM (pair_event."normal_commission_id" IS NOT NULL)
       OR (pair_event."flashout_amount" > 0) IS DISTINCT FROM (pair_event."flashout_commission_id" IS NOT NULL)
       OR (pair_event."normal_commission_id" IS NOT NULL
           AND normal."rule_version" IS DISTINCT FROM 'legacy-v1'
           AND (
            normal."type" IS DISTINCT FROM 'sponsor_point'::"CommissionType"
         OR normal."rule_version" IS DISTINCT FROM 'product-binary-v1'
         OR normal."is_pair_overflow" IS DISTINCT FROM false
         OR normal."user_id" IS DISTINCT FROM pair_event."recipient_user_id"
         OR normal."source_user_id" IS DISTINCT FROM pair_event."source_user_id"
         OR normal."source_event_kind" IS DISTINCT FROM 'product_order'
         OR normal."source_event_id" IS DISTINCT FROM order_event."order_id"
         OR normal."amount" IS DISTINCT FROM pair_event."payable_amount"
         OR normal."points"::NUMERIC IS DISTINCT FROM pair_event."payable_pairs" * pair_event."pair_rate_points"
       ))
       OR (pair_event."flashout_commission_id" IS NOT NULL
           AND flashout."rule_version" IS DISTINCT FROM 'legacy-v1'
           AND (
            flashout."type" IS DISTINCT FROM 'sponsor_point'::"CommissionType"
         OR flashout."rule_version" IS DISTINCT FROM 'product-binary-v1'
         OR flashout."is_pair_overflow" IS DISTINCT FROM true
         OR flashout."source_user_id" IS DISTINCT FROM pair_event."source_user_id"
         OR flashout."source_event_kind" IS DISTINCT FROM 'product_order'
         OR flashout."source_event_id" IS DISTINCT FROM order_event."order_id"
         OR flashout."amount" IS DISTINCT FROM pair_event."flashout_amount"
         OR flashout."points"::NUMERIC IS DISTINCT FROM
              (pair_event."cap_flashout_pairs" + pair_event."inactive_flashout_pairs") * pair_event."pair_rate_points"
         OR flashout."overflow_to" IS DISTINCT FROM flashout."user_id"
         OR NOT EXISTS (
              SELECT 1 FROM "users" hiroma
              WHERE hiroma."id" = flashout."user_id"
                AND hiroma."username" = 'hiroma'
                AND hiroma."role" = 'admin'::"Role"
            )
       ))

    UNION ALL

    SELECT 'commission:' || commission."id" AS "issue_key"
    FROM "commissions" commission
    WHERE commission."type" = 'sponsor_point'::"CommissionType"
      AND commission."rule_version" = 'product-binary-v1'
      AND (
        (commission."is_pair_overflow" = false AND NOT EXISTS (
          SELECT 1 FROM "product_binary_pair_events" event
          WHERE event."normal_commission_id" = commission."id"
        ))
        OR
        (commission."is_pair_overflow" = true AND NOT EXISTS (
          SELECT 1 FROM "product_binary_pair_events" event
          WHERE event."flashout_commission_id" = commission."id"
        ))
      )
    ORDER BY "issue_key"
    LIMIT 25
  ) invalid;

  IF invalid_product_entitlements IS NOT NULL THEN
    RAISE EXCEPTION
      'Historical Product Binary commission entitlement requires reconciliation before exact-entitlement migration: %',
      invalid_product_entitlements
      USING ERRCODE = '23514';
  END IF;
END $$;

-- A registration/upgrade may apply volume once, and only with the exact user,
-- points, placement parent, and placement leg sealed by its paid financial row.
CREATE OR REPLACE FUNCTION "validate_binary_settlement_source_entitlement"()
RETURNS TRIGGER AS $$
DECLARE
  expected_source_user_id TEXT;
  expected_source_points INTEGER;
  actual_parent_node_id TEXT;
  actual_source_leg TEXT;
BEGIN
  IF NEW."source_kind" = 'registration' THEN
    SELECT rf."reseller_id", rf."binary_points_per_pair"
    INTO expected_source_user_id, expected_source_points
    FROM "registration_financials" rf
    WHERE rf."pin_id" = NEW."source_event_id"
      AND rf."payment_status" = 'paid'
    FOR SHARE;
  ELSIF NEW."source_kind" = 'upgrade' THEN
    SELECT uf."reseller_id", uf."binary_points_difference"
    INTO expected_source_user_id, expected_source_points
    FROM "upgrade_financials" uf
    WHERE uf."upgrade_pin_id" = NEW."source_event_id"
      AND uf."payment_status" = 'paid'
    FOR SHARE;
  ELSE
    RAISE EXCEPTION 'Package Binary source kind is unsupported.' USING ERRCODE = '23514';
  END IF;

  IF expected_source_user_id IS NULL
     OR NEW."source_user_id" IS DISTINCT FROM expected_source_user_id
     OR NEW."source_points" IS DISTINCT FROM expected_source_points THEN
    RAISE EXCEPTION 'Package Binary settlement does not match its paid registration/upgrade source.' USING ERRCODE = '23514';
  END IF;

  SELECT node."parent_id", node."position"::text
  INTO actual_parent_node_id, actual_source_leg
  FROM "binary_tree_nodes" node
  WHERE node."user_id" = NEW."source_user_id"
  FOR SHARE;

  IF actual_parent_node_id IS NULL
     OR NEW."parent_node_id" IS DISTINCT FROM actual_parent_node_id
     OR NEW."source_leg" IS DISTINCT FROM actual_source_leg THEN
    RAISE EXCEPTION 'Package Binary settlement parent/leg does not match the source member placement.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "binary_settlement_events_validate_source_entitlement" ON "binary_settlement_events";
CREATE TRIGGER "binary_settlement_events_validate_source_entitlement"
BEFORE INSERT ON "binary_settlement_events"
FOR EACH ROW EXECUTE FUNCTION "validate_binary_settlement_source_entitlement"();

-- Pair audit rows must be a real ancestor reached from the sealed settlement
-- parent. The effective leg changes at each ancestor exactly as the tree path
-- changes, so merely naming an existing source event is insufficient.
CREATE OR REPLACE FUNCTION "validate_binary_pair_event_entitlement"()
RETURNS TRIGGER AS $$
DECLARE
  settlement_source_user_id TEXT;
  settlement_source_points INTEGER;
  settlement_parent_node_id TEXT;
  settlement_source_leg TEXT;
  expected_recipient_leg TEXT;
  current_left_points INTEGER;
  current_right_points INTEGER;
  current_daily_pairing_count INTEGER;
  current_daily_pairing_date DATE;
  available_left_points INTEGER;
  available_right_points INTEGER;
  expected_package_id TEXT;
  expected_package_name TEXT;
  expected_points_per_pair INTEGER;
  expected_user_status TEXT;
  expected_cap_enabled BOOLEAN;
  expected_cap_limit INTEGER;
  event_pairing_day DATE;
  used_today INTEGER;
  expected_within_cap INTEGER;
  expected_payable_pairs INTEGER;
  expected_cap_flashout_pairs INTEGER;
  expected_inactive_flashout_pairs INTEGER;
BEGIN
  -- Use the same lock key as the application so even direct SQL callers
  -- cannot race two cap/carryover decisions for one recipient.
  PERFORM pg_advisory_xact_lock(hashtext('binary:' || NEW."recipient_user_id"));

  SELECT event."source_user_id", event."source_points", event."parent_node_id", event."source_leg"
  INTO settlement_source_user_id, settlement_source_points,
       settlement_parent_node_id, settlement_source_leg
  FROM "binary_settlement_events" event
  WHERE event."source_kind" = NEW."source_kind"
    AND event."source_event_id" = NEW."source_event_id"
  FOR SHARE;

  IF settlement_source_user_id IS NULL
     OR NEW."source_user_id" IS DISTINCT FROM settlement_source_user_id
     OR NEW."source_points" IS DISTINCT FROM settlement_source_points THEN
    RAISE EXCEPTION 'Package Binary pair event does not match its settlement source.' USING ERRCODE = '23514';
  END IF;

  WITH RECURSIVE ancestor_chain AS (
    SELECT node."id", node."user_id", node."parent_id", node."position",
           settlement_source_leg::text AS effective_leg
    FROM "binary_tree_nodes" node
    WHERE node."id" = settlement_parent_node_id

    UNION ALL

    SELECT parent."id", parent."user_id", parent."parent_id", parent."position",
           child."position"::text AS effective_leg
    FROM ancestor_chain child
    JOIN "binary_tree_nodes" parent ON parent."id" = child."parent_id"
  )
  SELECT chain.effective_leg
  INTO expected_recipient_leg
  FROM ancestor_chain chain
  WHERE chain."user_id" = NEW."recipient_user_id"
  LIMIT 1;

  IF expected_recipient_leg IS NULL OR NEW."source_leg" IS DISTINCT FROM expected_recipient_leg THEN
    RAISE EXCEPTION 'Package Binary recipient is not an ancestor on the sealed source leg.' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(profile."left_points", 0), COALESCE(profile."right_points", 0),
         COALESCE(profile."daily_pairing_count", 0), profile."daily_pairing_date",
         profile."package_id", package."name",
         ROUND(COALESCE(package."pairing_bonus_value", 0))::INTEGER,
         recipient."status"::text,
         COALESCE(package."binary_pair_cap_enabled", true),
         GREATEST(1, COALESCE(package."daily_binary_pair_cap", 10))::INTEGER
  INTO current_left_points, current_right_points,
       current_daily_pairing_count, current_daily_pairing_date,
       expected_package_id, expected_package_name, expected_points_per_pair,
       expected_user_status, expected_cap_enabled, expected_cap_limit
  FROM "reseller_profiles" profile
  JOIN "packages" package ON package."id" = profile."package_id"
  JOIN "users" recipient ON recipient."id" = profile."user_id"
  WHERE profile."user_id" = NEW."recipient_user_id"
  FOR UPDATE OF profile
  FOR SHARE OF package, recipient;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Package Binary recipient has no package/carryover profile.' USING ERRCODE = '23503';
  END IF;

  IF NEW."completed_pairs" < 0
     OR NEW."points_per_pair" <= 0
     OR NEW."points_per_pair" IS DISTINCT FROM expected_points_per_pair
     OR NEW."recipient_package_id" IS DISTINCT FROM expected_package_id
     OR NEW."package_name_snapshot" IS DISTINCT FROM expected_package_name
     OR NEW."package_snapshot_source" IS DISTINCT FROM 'exact_event'
     OR (NEW."created_at" AT TIME ZONE 'Asia/Manila')::date IS DISTINCT FROM
          (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
     OR NEW."source_points" <= 0
     OR NEW."peso_per_point" <= 0
     OR NEW."peso_per_point" IS DISTINCT FROM 0.5
     OR NEW."consumed_left_points" IS DISTINCT FROM NEW."completed_pairs" * NEW."points_per_pair"
     OR NEW."consumed_right_points" IS DISTINCT FROM NEW."completed_pairs" * NEW."points_per_pair"
     OR NEW."pair_value_snapshot" IS DISTINCT FROM NEW."points_per_pair" * NEW."peso_per_point"
     OR NEW."payable_amount" IS DISTINCT FROM NEW."payable_pairs" * NEW."points_per_pair" * NEW."peso_per_point"
     OR NEW."flashout_amount" IS DISTINCT FROM
          (NEW."cap_flashout_pairs" + NEW."inactive_flashout_pairs") * NEW."points_per_pair" * NEW."peso_per_point"
     OR (NEW."payable_amount" > 0) IS DISTINCT FROM (NEW."normal_commission_id" IS NOT NULL)
     OR (NEW."flashout_amount" > 0) IS DISTINCT FROM (NEW."flashout_commission_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'Package Binary pair amounts or commission links are inconsistent.' USING ERRCODE = '23514';
  END IF;

  -- The event is inserted before the application mutates this locked profile,
  -- so an attacker cannot fabricate an opposite-leg opening balance and use it
  -- to mint a pair. This specifically rejects a 0/0 profile claiming 0/600 as
  -- its opening state for a new 600-point left-leg source.
  available_left_points := NEW."opening_left_points"
    + CASE WHEN NEW."source_leg" = 'left' THEN NEW."source_points" ELSE 0 END;
  available_right_points := NEW."opening_right_points"
    + CASE WHEN NEW."source_leg" = 'right' THEN NEW."source_points" ELSE 0 END;

  IF NEW."opening_left_points" IS DISTINCT FROM current_left_points
     OR NEW."opening_right_points" IS DISTINCT FROM current_right_points
     OR NEW."opening_left_points" < 0 OR NEW."opening_right_points" < 0
     OR NEW."closing_left_points" < 0 OR NEW."closing_right_points" < 0
     OR NEW."completed_pairs" IS DISTINCT FROM (CASE
          WHEN NEW."points_per_pair" > 0
            THEN LEAST(available_left_points, available_right_points) / NEW."points_per_pair"
          ELSE 0
        END)
     OR NEW."closing_left_points" IS DISTINCT FROM
          available_left_points - NEW."consumed_left_points"
     OR NEW."closing_right_points" IS DISTINCT FROM
          available_right_points - NEW."consumed_right_points" THEN
    RAISE EXCEPTION 'Package Binary pair does not reconcile to locked opening carryover and exact source volume.' USING ERRCODE = '23514';
  END IF;

  event_pairing_day := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date;
  used_today := CASE
    WHEN current_daily_pairing_date = event_pairing_day
      THEN current_daily_pairing_count
    ELSE 0
  END;
  expected_within_cap := CASE
    WHEN expected_cap_enabled
      THEN LEAST(NEW."completed_pairs", GREATEST(0, expected_cap_limit - used_today))
    ELSE NEW."completed_pairs"
  END;
  expected_cap_flashout_pairs := NEW."completed_pairs" - expected_within_cap;
  expected_payable_pairs := CASE
    WHEN expected_user_status = 'active' THEN expected_within_cap
    ELSE 0
  END;
  expected_inactive_flashout_pairs := CASE
    WHEN expected_user_status = 'active' THEN 0
    ELSE expected_within_cap
  END;

  IF used_today < 0
     OR NEW."cap_enabled" IS DISTINCT FROM expected_cap_enabled
     OR NEW."cap_limit" IS DISTINCT FROM
          (CASE WHEN expected_cap_enabled THEN expected_cap_limit ELSE NULL END)
     OR NEW."payable_pairs" IS DISTINCT FROM expected_payable_pairs
     OR NEW."cap_flashout_pairs" IS DISTINCT FROM expected_cap_flashout_pairs
     OR NEW."inactive_flashout_pairs" IS DISTINCT FROM expected_inactive_flashout_pairs THEN
    RAISE EXCEPTION 'Package Binary payable/flashout partition does not match locked status and daily cap state.' USING ERRCODE = '23514';
  END IF;

  -- These cap snapshots are database-authored. The deferred verifier below
  -- proves the application applied both points and daily-cap state atomically.
  NEW."pairing_day" := event_pairing_day;
  NEW."opening_daily_pairing_count" := used_today;
  NEW."closing_daily_pairing_count" := used_today + expected_within_cap;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "binary_pair_events_validate_entitlement" ON "binary_pair_events";
CREATE TRIGGER "binary_pair_events_validate_entitlement"
BEFORE INSERT ON "binary_pair_events"
FOR EACH ROW EXECUTE FUNCTION "validate_binary_pair_event_entitlement"();

CREATE OR REPLACE FUNCTION "validate_binary_pair_event_closing_state"()
RETURNS TRIGGER AS $$
DECLARE
  applied_left_points INTEGER;
  applied_right_points INTEGER;
  applied_daily_pairing_count INTEGER;
  applied_daily_pairing_date DATE;
BEGIN
  SELECT COALESCE(profile."left_points", 0), COALESCE(profile."right_points", 0),
         COALESCE(profile."daily_pairing_count", 0), profile."daily_pairing_date"
  INTO applied_left_points, applied_right_points,
       applied_daily_pairing_count, applied_daily_pairing_date
  FROM "reseller_profiles" profile
  WHERE profile."user_id" = NEW."recipient_user_id"
  FOR SHARE;

  IF NOT FOUND
     OR applied_left_points IS DISTINCT FROM NEW."closing_left_points"
     OR applied_right_points IS DISTINCT FROM NEW."closing_right_points"
     OR applied_daily_pairing_date IS DISTINCT FROM NEW."pairing_day"
     OR applied_daily_pairing_count IS DISTINCT FROM NEW."closing_daily_pairing_count" THEN
    RAISE EXCEPTION 'Package Binary event closing carryover/cap state was not applied atomically.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "binary_pair_events_validate_closing_state" ON "binary_pair_events";
CREATE CONSTRAINT TRIGGER "binary_pair_events_validate_closing_state"
AFTER INSERT ON "binary_pair_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_binary_pair_event_closing_state"();

-- A valid row is not enough if a future writer can omit one or more uplines.
-- At commit, require the exact set of ancestors that currently have reseller
-- profiles to have one volume event each (the unique index prevents doubles).
CREATE OR REPLACE FUNCTION "validate_binary_settlement_event_completeness"()
RETURNS TRIGGER AS $$
DECLARE
  ancestor_set_mismatch BOOLEAN;
BEGIN
  WITH RECURSIVE ancestor_chain AS (
    SELECT node."id", node."user_id", node."parent_id"
    FROM "binary_tree_nodes" node
    WHERE node."id" = NEW."parent_node_id"

    UNION ALL

    SELECT parent."id", parent."user_id", parent."parent_id"
    FROM ancestor_chain child
    JOIN "binary_tree_nodes" parent ON parent."id" = child."parent_id"
  ),
  expected_recipients AS (
    SELECT chain."user_id"
    FROM ancestor_chain chain
    JOIN "reseller_profiles" profile ON profile."user_id" = chain."user_id"
  ),
  recorded_recipients AS (
    SELECT event."recipient_user_id" AS "user_id"
    FROM "binary_pair_events" event
    WHERE event."source_kind" = NEW."source_kind"
      AND event."source_event_id" = NEW."source_event_id"
  )
  SELECT EXISTS (
    (SELECT expected."user_id" FROM expected_recipients expected
     EXCEPT
     SELECT recorded."user_id" FROM recorded_recipients recorded)
    UNION ALL
    (SELECT recorded."user_id" FROM recorded_recipients recorded
     EXCEPT
     SELECT expected."user_id" FROM expected_recipients expected)
  )
  INTO ancestor_set_mismatch;

  IF ancestor_set_mismatch THEN
    RAISE EXCEPTION 'Package Binary settlement does not contain one exact volume event for every eligible ancestor.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "binary_settlement_events_validate_completeness" ON "binary_settlement_events";
CREATE CONSTRAINT TRIGGER "binary_settlement_events_validate_completeness"
AFTER INSERT ON "binary_settlement_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_binary_settlement_event_completeness"();

-- Seal the reverse direction as well: creating paid economics/reserve funding
-- is not complete unless its positive Package Binary volume is settled in the
-- same transaction. Otherwise a new writer could consume a PIN but silently
-- omit every upline's carryover.
CREATE OR REPLACE FUNCTION "require_registration_binary_settlement"()
RETURNS TRIGGER AS $$
DECLARE
  exact_settlement_count INTEGER;
BEGIN
  IF NEW."payment_status" = 'paid' AND NEW."binary_points_per_pair" > 0 THEN
    SELECT COUNT(*)::INTEGER
    INTO exact_settlement_count
    FROM "binary_settlement_events" event
    WHERE event."source_kind" = 'registration'
      AND event."source_event_id" = NEW."pin_id"
      AND event."source_user_id" = NEW."reseller_id"
      AND event."source_points" = NEW."binary_points_per_pair";

    IF exact_settlement_count IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'Paid registration economics must commit with one exact Package Binary settlement.' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "registration_financials_require_binary_settlement" ON "registration_financials";
CREATE CONSTRAINT TRIGGER "registration_financials_require_binary_settlement"
AFTER INSERT ON "registration_financials"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_registration_binary_settlement"();

CREATE OR REPLACE FUNCTION "require_upgrade_binary_settlement"()
RETURNS TRIGGER AS $$
DECLARE
  exact_settlement_count INTEGER;
BEGIN
  IF NEW."payment_status" = 'paid' AND NEW."binary_points_difference" > 0 THEN
    SELECT COUNT(*)::INTEGER
    INTO exact_settlement_count
    FROM "binary_settlement_events" event
    WHERE event."source_kind" = 'upgrade'
      AND event."source_event_id" = NEW."upgrade_pin_id"
      AND event."source_user_id" = NEW."reseller_id"
      AND event."source_points" = NEW."binary_points_difference";

    IF exact_settlement_count IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'Paid upgrade economics must commit with one exact Package Binary settlement.' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "upgrade_financials_require_binary_settlement" ON "upgrade_financials";
CREATE CONSTRAINT TRIGGER "upgrade_financials_require_binary_settlement"
AFTER INSERT ON "upgrade_financials"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_upgrade_binary_settlement"();

-- A Product Binary order event is allowed only for a paid, delivered commerce
-- order to a reseller, and its immutable quantities/margin must equal the order
-- items at the moment the event is inserted. Zero-PU orders remain supported:
-- the worker completes their durable job without inserting an order event.
CREATE OR REPLACE FUNCTION "validate_product_binary_order_event_source"()
RETURNS TRIGGER AS $$
DECLARE
  source_order RECORD;
BEGIN
  PERFORM 1 FROM "orders" WHERE "id" = NEW."order_id" FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product Binary source order does not exist.' USING ERRCODE = '23503';
  END IF;

  SELECT
    orders."buyer_id" AS buyer_user_id,
    buyer."role"::text AS buyer_role,
    orders."status"::text AS order_status,
    orders."payment_status" AS payment_status,
    orders."financial_purpose" AS financial_purpose,
    COALESCE(SUM(
      CASE WHEN product."binary_eligible" AND product."pu_value" > 0
        THEN item."quantity" ELSE 0 END
    ), 0)::INTEGER AS eligible_units,
    COALESCE(SUM(
      CASE WHEN product."binary_eligible" AND product."pu_value" > 0
        THEN item."quantity" * product."pu_value" ELSE 0 END
    ), 0)::INTEGER AS total_pu,
    COALESCE(SUM(
      CASE WHEN product."binary_eligible" AND product."pu_value" > 0
        THEN item."quantity" * (
          item."unit_price" - COALESCE(item."unit_acquisition_cost", product."cost_price")
        ) ELSE 0 END
    ), 0)::DECIMAL(12,2) AS recorded_gross_margin
  INTO source_order
  FROM "orders" orders
  JOIN "users" buyer ON buyer."id" = orders."buyer_id"
  JOIN "order_items" item ON item."order_id" = orders."id"
  JOIN "products" product ON product."id" = item."product_id"
  WHERE orders."id" = NEW."order_id"
  GROUP BY orders."id", orders."buyer_id", buyer."role", orders."status",
           orders."payment_status", orders."financial_purpose";

  IF NOT FOUND
     OR source_order.buyer_role IS DISTINCT FROM 'reseller'
     OR source_order.order_status IS DISTINCT FROM 'delivered'
     OR source_order.payment_status IS DISTINCT FROM 'paid'
     OR source_order.financial_purpose IS DISTINCT FROM 'commerce'
     OR NEW."buyer_user_id" IS DISTINCT FROM source_order.buyer_user_id
     OR NEW."eligible_units" IS DISTINCT FROM source_order.eligible_units
     OR NEW."total_pu" IS DISTINCT FROM source_order.total_pu
     OR NEW."recorded_gross_margin" IS DISTINCT FROM source_order.recorded_gross_margin
     OR NEW."eligible_units" <= 0 OR NEW."total_pu" <= 0 THEN
    RAISE EXCEPTION 'Product Binary event does not match a paid delivered reseller commerce order.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "product_binary_order_events_validate_source" ON "product_binary_order_events";
CREATE TRIGGER "product_binary_order_events_validate_source"
BEFORE INSERT ON "product_binary_order_events"
FOR EACH ROW EXECUTE FUNCTION "validate_product_binary_order_event_source"();

CREATE OR REPLACE FUNCTION "validate_product_binary_pair_event_entitlement"()
RETURNS TRIGGER AS $$
DECLARE
  source_buyer_user_id TEXT;
  source_total_pu INTEGER;
  expected_recipient_leg TEXT;
  current_left_pu INTEGER;
  current_right_pu INTEGER;
  current_lifetime_pairs INTEGER;
  current_lifetime_payable INTEGER;
  current_lifetime_flashout INTEGER;
  available_left_pu INTEGER;
  available_right_pu INTEGER;
  expected_package_id TEXT;
  expected_package_name TEXT;
  recipient_total_pu INTEGER;
  expected_rank_id TEXT;
  expected_rank_name TEXT;
  package_rate_points NUMERIC;
  rank_rate_points NUMERIC;
  configured_rate_points NUMERIC;
  expected_pair_rate_amount NUMERIC;
  expected_pair_rate_points NUMERIC;
  expected_user_status TEXT;
  expected_cap_enabled BOOLEAN;
  expected_cap_limit INTEGER;
  used_today INTEGER;
  expected_payable_pairs INTEGER;
  expected_cap_flashout_pairs INTEGER;
  expected_inactive_flashout_pairs INTEGER;
BEGIN
  -- Serialize even direct SQL callers on the same key used by the worker.
  PERFORM pg_advisory_xact_lock(hashtext('product-binary-user:' || NEW."recipient_user_id"));

  SELECT event."buyer_user_id", event."total_pu"
  INTO source_buyer_user_id, source_total_pu
  FROM "product_binary_order_events" event
  WHERE event."id" = NEW."order_event_id"
  FOR SHARE;

  IF source_buyer_user_id IS NULL
     OR NEW."source_user_id" IS DISTINCT FROM source_buyer_user_id
     OR NEW."source_pu" IS DISTINCT FROM source_total_pu THEN
    RAISE EXCEPTION 'Product Binary pair event does not match its order event source.' USING ERRCODE = '23514';
  END IF;

  WITH RECURSIVE ancestor_chain AS (
    SELECT parent."id", parent."user_id", parent."parent_id", parent."position",
           source."position"::text AS effective_leg
    FROM "binary_tree_nodes" source
    JOIN "binary_tree_nodes" parent ON parent."id" = source."parent_id"
    WHERE source."user_id" = source_buyer_user_id

    UNION ALL

    SELECT parent."id", parent."user_id", parent."parent_id", parent."position",
           child."position"::text AS effective_leg
    FROM ancestor_chain child
    JOIN "binary_tree_nodes" parent ON parent."id" = child."parent_id"
  )
  SELECT chain.effective_leg
  INTO expected_recipient_leg
  FROM ancestor_chain chain
  WHERE chain."user_id" = NEW."recipient_user_id"
  LIMIT 1;

  IF expected_recipient_leg IS NULL OR NEW."source_leg" IS DISTINCT FROM expected_recipient_leg THEN
    RAISE EXCEPTION 'Product Binary recipient is not an ancestor on the source order leg.' USING ERRCODE = '23514';
  END IF;

  SELECT profile."package_id", package."name", COALESCE(profile."total_pu", 0),
         package."point_php_value", recipient."status"::text,
         COALESCE(package."product_binary_cap_enabled", true),
         GREATEST(0, COALESCE(package."daily_product_pairing_cap", 50))::INTEGER
  INTO expected_package_id, expected_package_name, recipient_total_pu,
       package_rate_points, expected_user_status, expected_cap_enabled,
       expected_cap_limit
  FROM "reseller_profiles" profile
  JOIN "packages" package ON package."id" = profile."package_id"
  JOIN "users" recipient ON recipient."id" = profile."user_id"
  WHERE profile."user_id" = NEW."recipient_user_id"
  FOR SHARE OF profile, package, recipient;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product Binary recipient has no package profile.' USING ERRCODE = '23503';
  END IF;

  SELECT rank."id", rank."name", rank."pair_income"
  INTO expected_rank_id, expected_rank_name, rank_rate_points
  FROM "ranks" rank
  WHERE rank."package_id" = expected_package_id
    AND rank."required_pu" <= recipient_total_pu
  ORDER BY rank."sequence" DESC
  LIMIT 1
  FOR SHARE;

  IF NOT FOUND THEN
    expected_rank_id := NULL;
    expected_rank_name := 'Default';
    configured_rate_points := package_rate_points;
  ELSE
    configured_rate_points := rank_rate_points;
  END IF;

  expected_pair_rate_amount := LEAST(configured_rate_points * 0.5, 20.00);
  expected_pair_rate_points := expected_pair_rate_amount / 0.5;

  SELECT position."left_carryover_pu", position."right_carryover_pu",
         position."lifetime_pairs", position."lifetime_payable",
         position."lifetime_flashout"
  INTO current_left_pu, current_right_pu, current_lifetime_pairs,
       current_lifetime_payable, current_lifetime_flashout
  FROM "product_binary_positions" position
  WHERE position."user_id" = NEW."recipient_user_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product Binary recipient has no locked carryover position.' USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(SUM(event."payable_pairs"), 0)::INTEGER
  INTO used_today
  FROM "product_binary_pair_events" event
  WHERE event."recipient_user_id" = NEW."recipient_user_id"
    AND (event."created_at" AT TIME ZONE 'Asia/Manila')::date =
        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date;

  IF expected_user_status <> 'active' THEN
    expected_payable_pairs := 0;
    expected_cap_flashout_pairs := 0;
    expected_inactive_flashout_pairs := NEW."completed_pairs";
  ELSIF NOT expected_cap_enabled THEN
    expected_payable_pairs := NEW."completed_pairs";
    expected_cap_flashout_pairs := 0;
    expected_inactive_flashout_pairs := 0;
  ELSE
    expected_payable_pairs := LEAST(
      NEW."completed_pairs",
      GREATEST(0, expected_cap_limit - used_today)
    );
    expected_cap_flashout_pairs := NEW."completed_pairs" - expected_payable_pairs;
    expected_inactive_flashout_pairs := 0;
  END IF;

  IF NEW."completed_pairs" < 0
     OR NEW."source_pu" <= 0
     OR NEW."pair_rate_points" < 0
     OR NEW."pair_rate_points" IS DISTINCT FROM expected_pair_rate_points
     OR NEW."peso_per_point" <= 0
     OR NEW."peso_per_point" IS DISTINCT FROM 0.5
     OR NEW."package_id_snapshot" IS DISTINCT FROM expected_package_id
     OR NEW."package_name_snapshot" IS DISTINCT FROM expected_package_name
     OR NEW."rank_id_snapshot" IS DISTINCT FROM expected_rank_id
     OR NEW."rank_name_snapshot" IS DISTINCT FROM expected_rank_name
     OR (NEW."created_at" AT TIME ZONE 'Asia/Manila')::date IS DISTINCT FROM
          (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
     OR NEW."pair_rate_amount" IS DISTINCT FROM expected_pair_rate_amount
     OR NEW."pair_rate_amount" IS DISTINCT FROM NEW."pair_rate_points" * NEW."peso_per_point"
     OR NEW."payable_amount" IS DISTINCT FROM NEW."payable_pairs" * NEW."pair_rate_amount"
     OR NEW."flashout_amount" IS DISTINCT FROM
          (NEW."cap_flashout_pairs" + NEW."inactive_flashout_pairs") * NEW."pair_rate_amount"
     OR NEW."cap_enabled" IS DISTINCT FROM expected_cap_enabled
     OR NEW."cap_limit" IS DISTINCT FROM
          (CASE WHEN expected_cap_enabled THEN expected_cap_limit ELSE NULL END)
     OR NEW."payable_pairs" IS DISTINCT FROM expected_payable_pairs
     OR NEW."cap_flashout_pairs" IS DISTINCT FROM expected_cap_flashout_pairs
     OR NEW."inactive_flashout_pairs" IS DISTINCT FROM expected_inactive_flashout_pairs
     OR (NEW."payable_amount" > 0) IS DISTINCT FROM (NEW."normal_commission_id" IS NOT NULL)
     OR (NEW."flashout_amount" > 0) IS DISTINCT FROM (NEW."flashout_commission_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'Product Binary pair amounts or commission links are inconsistent.' USING ERRCODE = '23514';
  END IF;

  available_left_pu := NEW."opening_left_pu"
    + CASE WHEN NEW."source_leg" = 'left' THEN NEW."source_pu" ELSE 0 END;
  available_right_pu := NEW."opening_right_pu"
    + CASE WHEN NEW."source_leg" = 'right' THEN NEW."source_pu" ELSE 0 END;

  IF NEW."opening_left_pu" IS DISTINCT FROM current_left_pu
     OR NEW."opening_right_pu" IS DISTINCT FROM current_right_pu
     OR NEW."opening_lifetime_pairs" IS DISTINCT FROM current_lifetime_pairs
     OR NEW."opening_lifetime_payable" IS DISTINCT FROM current_lifetime_payable
     OR NEW."opening_lifetime_flashout" IS DISTINCT FROM current_lifetime_flashout
     OR NEW."opening_left_pu" < 0 OR NEW."opening_right_pu" < 0
     OR NEW."closing_left_pu" < 0 OR NEW."closing_right_pu" < 0
     OR NEW."completed_pairs" IS DISTINCT FROM LEAST(available_left_pu, available_right_pu) / 2
     OR NEW."closing_left_pu" IS DISTINCT FROM available_left_pu - NEW."completed_pairs" * 2
     OR NEW."closing_right_pu" IS DISTINCT FROM available_right_pu - NEW."completed_pairs" * 2
     OR NEW."closing_lifetime_pairs" IS DISTINCT FROM current_lifetime_pairs + NEW."completed_pairs"
     OR NEW."closing_lifetime_payable" IS DISTINCT FROM current_lifetime_payable + NEW."payable_pairs"
     OR NEW."closing_lifetime_flashout" IS DISTINCT FROM current_lifetime_flashout
          + NEW."cap_flashout_pairs" + NEW."inactive_flashout_pairs" THEN
    RAISE EXCEPTION 'Product Binary pair does not reconcile to locked carryover and exact source PU.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "product_binary_pair_events_validate_entitlement" ON "product_binary_pair_events";
CREATE TRIGGER "product_binary_pair_events_validate_entitlement"
BEFORE INSERT ON "product_binary_pair_events"
FOR EACH ROW EXECUTE FUNCTION "validate_product_binary_pair_event_entitlement"();

CREATE OR REPLACE FUNCTION "validate_product_binary_pair_event_closing_state"()
RETURNS TRIGGER AS $$
DECLARE
  applied_left_pu INTEGER;
  applied_right_pu INTEGER;
  applied_lifetime_pairs INTEGER;
  applied_lifetime_payable INTEGER;
  applied_lifetime_flashout INTEGER;
BEGIN
  SELECT position."left_carryover_pu", position."right_carryover_pu",
         position."lifetime_pairs", position."lifetime_payable",
         position."lifetime_flashout"
  INTO applied_left_pu, applied_right_pu, applied_lifetime_pairs,
       applied_lifetime_payable, applied_lifetime_flashout
  FROM "product_binary_positions" position
  WHERE position."user_id" = NEW."recipient_user_id"
  FOR SHARE;

  IF NOT FOUND
     OR applied_left_pu IS DISTINCT FROM NEW."closing_left_pu"
     OR applied_right_pu IS DISTINCT FROM NEW."closing_right_pu"
     OR applied_lifetime_pairs IS DISTINCT FROM NEW."closing_lifetime_pairs"
     OR applied_lifetime_payable IS DISTINCT FROM NEW."closing_lifetime_payable"
     OR applied_lifetime_flashout IS DISTINCT FROM NEW."closing_lifetime_flashout" THEN
    RAISE EXCEPTION 'Product Binary event closing carryover/lifetime state was not applied atomically.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "product_binary_pair_events_validate_closing_state" ON "product_binary_pair_events";
CREATE CONSTRAINT TRIGGER "product_binary_pair_events_validate_closing_state"
AFTER INSERT ON "product_binary_pair_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_product_binary_pair_event_closing_state"();

CREATE OR REPLACE FUNCTION "validate_product_binary_order_event_completeness"()
RETURNS TRIGGER AS $$
DECLARE
  ancestor_set_mismatch BOOLEAN;
BEGIN
  WITH RECURSIVE ancestor_chain AS (
    SELECT parent."id", parent."user_id", parent."parent_id"
    FROM "binary_tree_nodes" source
    JOIN "binary_tree_nodes" parent ON parent."id" = source."parent_id"
    WHERE source."user_id" = NEW."buyer_user_id"

    UNION ALL

    SELECT parent."id", parent."user_id", parent."parent_id"
    FROM ancestor_chain child
    JOIN "binary_tree_nodes" parent ON parent."id" = child."parent_id"
  ),
  expected_recipients AS (
    SELECT chain."user_id"
    FROM ancestor_chain chain
    JOIN "reseller_profiles" profile ON profile."user_id" = chain."user_id"
  ),
  recorded_recipients AS (
    SELECT event."recipient_user_id" AS "user_id"
    FROM "product_binary_pair_events" event
    WHERE event."order_event_id" = NEW."id"
  )
  SELECT EXISTS (
    (SELECT expected."user_id" FROM expected_recipients expected
     EXCEPT
     SELECT recorded."user_id" FROM recorded_recipients recorded)
    UNION ALL
    (SELECT recorded."user_id" FROM recorded_recipients recorded
     EXCEPT
     SELECT expected."user_id" FROM expected_recipients expected)
  )
  INTO ancestor_set_mismatch;

  IF ancestor_set_mismatch THEN
    RAISE EXCEPTION 'Product Binary order event does not contain one exact volume event for every eligible ancestor.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "product_binary_order_events_validate_completeness" ON "product_binary_order_events";
CREATE CONSTRAINT TRIGGER "product_binary_order_events_validate_completeness"
AFTER INSERT ON "product_binary_order_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_product_binary_order_event_completeness"();

-- A completed positive-PU job must have the exact order event above. Explicit
-- zero-PU/ineligible completions remain valid and must have no fabricated event.
CREATE OR REPLACE FUNCTION "validate_product_binary_job_completion"()
RETURNS TRIGGER AS $$
DECLARE
  source_order RECORD;
  exact_order_event_count INTEGER;
BEGIN
  IF NEW."status" <> 'completed' THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM "orders" orders WHERE orders."id" = NEW."order_id" FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Completed Product Binary job has no source order.' USING ERRCODE = '23503';
  END IF;

  SELECT orders."status"::text AS order_status,
         buyer."role"::text AS buyer_role,
         COALESCE(SUM(
           CASE WHEN product."binary_eligible" AND product."pu_value" > 0
             THEN item."quantity" * product."pu_value" ELSE 0 END
         ), 0)::INTEGER AS total_pu
  INTO source_order
  FROM "orders" orders
  JOIN "users" buyer ON buyer."id" = orders."buyer_id"
  LEFT JOIN "order_items" item ON item."order_id" = orders."id"
  LEFT JOIN "products" product ON product."id" = item."product_id"
  WHERE orders."id" = NEW."order_id"
  GROUP BY orders."id", orders."status", buyer."role";

  IF NOT FOUND
     OR source_order.order_status IS DISTINCT FROM 'delivered'
     OR source_order.buyer_role IS DISTINCT FROM 'reseller'
     OR NEW."completed_at" IS NULL THEN
    RAISE EXCEPTION 'Only a delivered reseller order may complete a Product Binary job.' USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO exact_order_event_count
  FROM "product_binary_order_events" event
  WHERE event."order_id" = NEW."order_id";

  IF source_order.total_pu > 0 AND exact_order_event_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Positive-PU Product Binary job must commit with one exact order event.' USING ERRCODE = '23514';
  ELSIF source_order.total_pu <= 0 AND exact_order_event_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Zero-PU Product Binary job cannot claim a Product Binary order event.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "product_binary_jobs_validate_completion" ON "product_binary_settlement_jobs";
CREATE CONSTRAINT TRIGGER "product_binary_jobs_validate_completion"
AFTER INSERT OR UPDATE ON "product_binary_settlement_jobs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_product_binary_job_completion"();

-- This check is deliberately deferred. Direct referral creates the new tree
-- node after the commission; both binary implementations create the pair event
-- after the funded commission. The wallet/reserve writes may happen earlier in
-- the transaction, but PostgreSQL rolls all of them back if this commit-time
-- entitlement seal fails.
CREATE OR REPLACE FUNCTION "validate_exact_commission_entitlement"()
RETURNS TRIGGER AS $$
DECLARE
  direct_source_user_id TEXT;
  direct_sponsor_user_id TEXT;
  direct_source_allocation DECIMAL(12,2);
  direct_entitled_amount DECIMAL(12,2);
  direct_paid_count INTEGER;
  direct_retained_count INTEGER;
  direct_paid_amount DECIMAL(12,2);
  direct_retained_amount DECIMAL(12,2);
  exact_match_count INTEGER;
BEGIN
  IF NEW."type" = 'direct_referral'::"CommissionType" THEN
    SELECT rf."reseller_id", source_node."sponsor_id", rf."direct_referral_allocation",
           LEAST(sponsor_package."direct_referral_bonus", rf."direct_referral_allocation")::DECIMAL(12,2)
    INTO direct_source_user_id, direct_sponsor_user_id,
         direct_source_allocation, direct_entitled_amount
    FROM "registration_financials" rf
    JOIN "binary_tree_nodes" source_node ON source_node."user_id" = rf."reseller_id"
    JOIN "reseller_profiles" sponsor_profile ON sponsor_profile."user_id" = source_node."sponsor_id"
    JOIN "packages" sponsor_package ON sponsor_package."id" = sponsor_profile."package_id"
    WHERE rf."pin_id" = NEW."source_event_id"
      AND rf."payment_status" = 'paid'
    FOR SHARE OF rf, source_node, sponsor_profile, sponsor_package;

    IF direct_source_user_id IS NULL
       OR NEW."rule_version" IS DISTINCT FROM 'registration-direct-v1'
       OR NEW."source_event_kind" IS DISTINCT FROM 'registration'
       OR NEW."source_user_id" IS DISTINCT FROM direct_source_user_id THEN
      RAISE EXCEPTION 'Direct referral commission does not match the registered member and exact sponsor entitlement.' USING ERRCODE = '23514';
    END IF;

    IF NEW."is_pair_overflow" = false THEN
      IF NEW."user_id" IS DISTINCT FROM direct_sponsor_user_id
         OR NEW."amount" IS DISTINCT FROM direct_entitled_amount THEN
        RAISE EXCEPTION 'Direct referral commission does not match the registered member and exact sponsor entitlement.' USING ERRCODE = '23514';
      END IF;
    ELSE
      -- Retained direct-referral evidence is non-spendable. Its exact daily-cap
      -- decision cannot be reconstructed without a dedicated immutable event,
      -- but it may never name another source, exceed the sealed allocation, or
      -- be retained by an account other than the Hiroma system account.
      IF NEW."amount" <= 0
         OR NEW."amount" > direct_source_allocation
         OR NEW."overflow_to" IS DISTINCT FROM NEW."user_id"
         OR NOT EXISTS (
              SELECT 1 FROM "users" hiroma
              WHERE hiroma."id" = NEW."user_id"
                AND hiroma."username" = 'hiroma'
                AND hiroma."role" = 'admin'::"Role"
            ) THEN
        RAISE EXCEPTION 'Retained direct referral evidence exceeds its sealed registration source or is not assigned to Hiroma.' USING ERRCODE = '23514';
      END IF;
    END IF;

    SELECT
      COUNT(*) FILTER (WHERE commission."is_pair_overflow" = false)::INTEGER,
      COUNT(*) FILTER (WHERE commission."is_pair_overflow" = true)::INTEGER,
      COALESCE(SUM(commission."amount") FILTER (WHERE commission."is_pair_overflow" = false), 0)::DECIMAL(12,2),
      COALESCE(SUM(commission."amount") FILTER (WHERE commission."is_pair_overflow" = true), 0)::DECIMAL(12,2)
    INTO direct_paid_count, direct_retained_count,
         direct_paid_amount, direct_retained_amount
    FROM "commissions" commission
    WHERE commission."type" = 'direct_referral'::"CommissionType"
      AND commission."rule_version" = 'registration-direct-v1'
      AND commission."source_event_kind" = 'registration'
      AND commission."source_event_id" = NEW."source_event_id";

    IF direct_paid_count > 1 OR direct_retained_count > 1
       OR direct_paid_amount NOT IN (0, direct_entitled_amount)
       OR direct_retained_amount IS DISTINCT FROM direct_source_allocation - direct_paid_amount THEN
      RAISE EXCEPTION 'Direct referral paid and retained evidence does not exactly exhaust one sealed allocation.' USING ERRCODE = '23514';
    END IF;

  ELSIF NEW."type" = 'binary_pairing'::"CommissionType" THEN
    IF NEW."rule_version" IS DISTINCT FROM 'package-binary-v1' THEN
      RAISE EXCEPTION 'Package Binary commission uses an unsupported rule version.' USING ERRCODE = '23514';
    END IF;

    IF NEW."is_pair_overflow" = false THEN
      SELECT COUNT(*)::INTEGER
      INTO exact_match_count
      FROM "binary_pair_events" event
      WHERE event."normal_commission_id" = NEW."id"
        AND event."recipient_user_id" = NEW."user_id"
        AND event."source_user_id" = NEW."source_user_id"
        AND event."source_kind" = NEW."source_event_kind"
        AND event."source_event_id" = NEW."source_event_id"
        AND event."payable_amount" = NEW."amount"
        AND NEW."points" IS NOT NULL
        AND NEW."points"::NUMERIC = event."payable_pairs" * event."points_per_pair";

      IF exact_match_count <> 1 THEN
        RAISE EXCEPTION 'Package Binary commission has no exact immutable pair entitlement.' USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT COUNT(*)::INTEGER
      INTO exact_match_count
      FROM "binary_pair_events" event
      WHERE event."flashout_commission_id" = NEW."id"
        AND event."source_user_id" = NEW."source_user_id"
        AND event."source_kind" = NEW."source_event_kind"
        AND event."source_event_id" = NEW."source_event_id"
        AND event."flashout_amount" = NEW."amount"
        AND NEW."points" IS NOT NULL
        AND NEW."points"::NUMERIC =
            (event."cap_flashout_pairs" + event."inactive_flashout_pairs") * event."points_per_pair"
        AND NEW."overflow_to" = NEW."user_id"
        AND EXISTS (
          SELECT 1 FROM "users" hiroma
          WHERE hiroma."id" = NEW."user_id"
            AND hiroma."username" = 'hiroma'
            AND hiroma."role" = 'admin'::"Role"
        );

      IF exact_match_count <> 1 THEN
        RAISE EXCEPTION 'Retained Package Binary commission has no exact immutable pair entitlement.' USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF NEW."type" = 'sponsor_point'::"CommissionType" THEN
    IF NEW."rule_version" IS DISTINCT FROM 'product-binary-v1' THEN
      RAISE EXCEPTION 'Product Binary commission uses an unsupported rule version.' USING ERRCODE = '23514';
    END IF;

    IF NEW."is_pair_overflow" = false THEN
      SELECT COUNT(*)::INTEGER
      INTO exact_match_count
      FROM "product_binary_pair_events" pair_event
      JOIN "product_binary_order_events" order_event
        ON order_event."id" = pair_event."order_event_id"
      WHERE pair_event."normal_commission_id" = NEW."id"
        AND pair_event."recipient_user_id" = NEW."user_id"
        AND pair_event."source_user_id" = NEW."source_user_id"
        AND NEW."source_event_kind" = 'product_order'
        AND order_event."order_id" = NEW."source_event_id"
        AND pair_event."payable_amount" = NEW."amount"
        AND NEW."points" IS NOT NULL
        AND NEW."points"::NUMERIC = pair_event."payable_pairs" * pair_event."pair_rate_points";

      IF exact_match_count <> 1 THEN
        RAISE EXCEPTION 'Product Binary commission has no exact immutable pair entitlement.' USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT COUNT(*)::INTEGER
      INTO exact_match_count
      FROM "product_binary_pair_events" pair_event
      JOIN "product_binary_order_events" order_event
        ON order_event."id" = pair_event."order_event_id"
      WHERE pair_event."flashout_commission_id" = NEW."id"
        AND pair_event."source_user_id" = NEW."source_user_id"
        AND NEW."source_event_kind" = 'product_order'
        AND order_event."order_id" = NEW."source_event_id"
        AND pair_event."flashout_amount" = NEW."amount"
        AND NEW."points" IS NOT NULL
        AND NEW."points"::NUMERIC =
            (pair_event."cap_flashout_pairs" + pair_event."inactive_flashout_pairs") * pair_event."pair_rate_points"
        AND NEW."overflow_to" = NEW."user_id"
        AND EXISTS (
          SELECT 1 FROM "users" hiroma
          WHERE hiroma."id" = NEW."user_id"
            AND hiroma."username" = 'hiroma'
            AND hiroma."role" = 'admin'::"Role"
        );

      IF exact_match_count <> 1 THEN
        RAISE EXCEPTION 'Retained Product Binary commission has no exact immutable pair entitlement.' USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF NEW."type" = 'deactivation_wallet_transfer'::"CommissionType"
        AND NEW."is_pair_overflow" = true THEN
    -- Migration 1450 proves that the complete liquidation occurred. This
    -- complementary check binds its one retained commission to the same
    -- reseller, exact wallet value, rule version, and Hiroma account.
    SELECT COUNT(*)::INTEGER
    INTO exact_match_count
    FROM "reseller_deactivation_events" event
    WHERE event."id" = NEW."source_event_id"
      AND NEW."source_event_kind" = 'deactivation'
      AND NEW."rule_version" = 'reseller-deactivation-v1'
      AND event."reseller_id" = NEW."source_user_id"
      AND event."wallet_value" = NEW."amount"
      AND NEW."overflow_to" = NEW."user_id"
      AND EXISTS (
        SELECT 1 FROM "users" hiroma
        WHERE hiroma."id" = NEW."user_id"
          AND hiroma."username" = 'hiroma'
          AND hiroma."role" = 'admin'::"Role"
      );

    IF exact_match_count <> 1 THEN
      RAISE EXCEPTION 'Retained deactivation transfer has no exact immutable liquidation entitlement.' USING ERRCODE = '23514';
    END IF;

  ELSE
    RAISE EXCEPTION 'Spendable commission type has no exact entitlement rule.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "commissions_validate_exact_entitlement" ON "commissions";
CREATE CONSTRAINT TRIGGER "commissions_validate_exact_entitlement"
AFTER INSERT ON "commissions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_exact_commission_entitlement"();

COMMIT;
