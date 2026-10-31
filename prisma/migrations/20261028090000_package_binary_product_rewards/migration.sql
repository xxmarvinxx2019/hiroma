-- Future Package Binary eligible pairs can replace cash with one bottle.
-- No historical commissions or earned rewards are rewritten at cutover.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('package-binary-product-reward-policy'));
LOCK TABLE binary_pair_events, commissions IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE binary_pair_events
  ADD COLUMN product_reward_pairs INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN reward_interval INTEGER,
  ADD COLUMN reward_product_id TEXT REFERENCES products(id) ON DELETE RESTRICT,
  ADD COLUMN opening_reward_eligible_count BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT binary_reward_partition CHECK (
    product_reward_pairs BETWEEN 0 AND payable_pairs
    AND opening_reward_eligible_count >= 0
    AND (reward_interval IS NULL OR reward_interval BETWEEN 2 AND 1000)
    AND (reward_interval IS NOT NULL OR product_reward_pairs = 0)
  );

CREATE TABLE package_binary_product_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_event_id UUID NOT NULL UNIQUE REFERENCES binary_pair_events(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name_snapshot TEXT NOT NULL,
  unit_cost_snapshot DECIMAL(12,2) NOT NULL CHECK (unit_cost_snapshot > 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX package_binary_product_rewards_user_id_created_at_idx ON package_binary_product_rewards(user_id,created_at);
CREATE INDEX binary_pair_events_reward_progress_idx ON binary_pair_events(recipient_user_id) WHERE reward_interval IS NOT NULL;

-- Existing cash entitlement verifier definitions, extended for cash/product partition.
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
  reward_policy JSONB;
  reward_enabled BOOLEAN;
  expected_reward_interval INTEGER;
  expected_reward_product TEXT;
  expected_opening BIGINT;
  expected_products INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('package-binary-product-reward-policy'));
  SELECT value::jsonb INTO reward_policy FROM system_settings WHERE key='package_binary_product_reward';
  reward_enabled := COALESCE((reward_policy->>'enabled')::boolean,false);
  expected_reward_interval := COALESCE((reward_policy->>'interval')::integer,5);
  expected_reward_product := reward_policy->>'product_id';
  IF expected_reward_interval NOT BETWEEN 2 AND 1000 THEN
    RAISE EXCEPTION 'Invalid product reward interval.' USING ERRCODE='23514';
  END IF;
  IF reward_enabled THEN
    PERFORM 1 FROM products WHERE id=expected_reward_product AND is_active=true AND cost_price>0 FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Select an active reward bottle with a positive company cost.' USING ERRCODE='23514'; END IF;
  END IF;
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
     OR NEW."payable_amount" IS DISTINCT FROM (NEW."payable_pairs" - NEW."product_reward_pairs") * NEW."points_per_pair" * NEW."peso_per_point"
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

  SELECT COALESCE(SUM(payable_pairs),0) INTO expected_opening
  FROM binary_pair_events WHERE recipient_user_id=NEW.recipient_user_id AND reward_interval IS NOT NULL;
  expected_products := CASE WHEN reward_enabled THEN
    ((expected_opening + expected_payable_pairs) / expected_reward_interval - expected_opening / expected_reward_interval)::integer
    ELSE 0 END;
  IF NEW.opening_reward_eligible_count IS DISTINCT FROM expected_opening
    OR NEW.product_reward_pairs IS DISTINCT FROM expected_products
    OR NEW.reward_interval IS DISTINCT FROM (CASE WHEN reward_enabled THEN expected_reward_interval ELSE NULL END)
    OR NEW.reward_product_id IS DISTINCT FROM (CASE WHEN reward_enabled THEN expected_reward_product ELSE NULL END)
  THEN RAISE EXCEPTION 'Package Binary product reward does not match locked policy and eligible ordinal.' USING ERRCODE='23514'; END IF;

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
        AND NEW."points"::NUMERIC = (event."payable_pairs" - event."product_reward_pairs") * event."points_per_pair";

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

CREATE FUNCTION credit_package_binary_product_reward() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.product_reward_pairs > 0 THEN
    INSERT INTO public.package_binary_product_rewards
      (pair_event_id,user_id,product_id,product_name_snapshot,unit_cost_snapshot,quantity)
    SELECT NEW.id,NEW.recipient_user_id,p.id,p.name,p.cost_price,NEW.product_reward_pairs
    FROM public.products p WHERE p.id=NEW.reward_product_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reward bottle is unavailable.'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER binary_pair_events_credit_product_reward AFTER INSERT ON binary_pair_events
FOR EACH ROW EXECUTE FUNCTION credit_package_binary_product_reward();

CREATE FUNCTION validate_package_binary_product_reward() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() < 2 OR NOT EXISTS (
    SELECT 1 FROM binary_pair_events e JOIN products p ON p.id=e.reward_product_id
    WHERE e.id=NEW.pair_event_id AND e.recipient_user_id=NEW.user_id
      AND e.reward_product_id=NEW.product_id AND e.product_reward_pairs=NEW.quantity
      AND NEW.product_name_snapshot=p.name AND NEW.unit_cost_snapshot=p.cost_price
  ) THEN RAISE EXCEPTION 'Product rewards require an exact Package Binary entitlement.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER package_binary_product_rewards_validate BEFORE INSERT ON package_binary_product_rewards
FOR EACH ROW EXECUTE FUNCTION validate_package_binary_product_reward();
CREATE TRIGGER package_binary_product_rewards_append_only BEFORE UPDATE OR DELETE ON package_binary_product_rewards
FOR EACH ROW EXECUTE FUNCTION reject_financial_history_change();
CREATE TRIGGER package_binary_product_rewards_no_truncate BEFORE TRUNCATE ON package_binary_product_rewards
FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();

REVOKE ALL ON FUNCTION credit_package_binary_product_reward() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_package_binary_product_reward() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_binary_pair_event_entitlement() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_exact_commission_entitlement() FROM PUBLIC;
COMMIT;
