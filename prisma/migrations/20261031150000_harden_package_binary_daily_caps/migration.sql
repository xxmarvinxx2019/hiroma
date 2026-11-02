BEGIN;
-- Quiesce registration/upgrade settlement during rollout; preserve financial history.
SELECT pg_advisory_xact_lock(hashtext('package-binary-product-reward-policy'));
LOCK TABLE binary_pair_events,reseller_profiles IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM reseller_profiles WHERE daily_pairing_count>0 AND daily_pairing_date IS NULL)
 THEN RAISE EXCEPTION 'Daily pairing counters without a date require reconciliation.'; END IF;
END $$;
CREATE TABLE binary_daily_cap_usage (
 user_id TEXT NOT NULL REFERENCES users(id), pairing_day DATE NOT NULL,
 used_pairs BIGINT NOT NULL CHECK(used_pairs>=0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(user_id,pairing_day)
);
-- Eligible cash/product pairs and inactive within-cap consumption all use allowance.
INSERT INTO binary_daily_cap_usage(user_id,pairing_day,used_pairs)
 SELECT recipient_user_id,COALESCE(pairing_day,(created_at AT TIME ZONE 'Asia/Manila')::date),
   SUM(payable_pairs::bigint+inactive_flashout_pairs::bigint)
 FROM binary_pair_events GROUP BY 1,2;
-- Do not grant extra allowance where historical event coverage is incomplete.
INSERT INTO binary_daily_cap_usage(user_id,pairing_day,used_pairs)
 SELECT user_id,daily_pairing_date,GREATEST(daily_pairing_count,0)
 FROM reseller_profiles WHERE daily_pairing_date IS NOT NULL AND daily_pairing_count>0
 ON CONFLICT(user_id,pairing_day) DO UPDATE
 SET used_pairs=GREATEST(binary_daily_cap_usage.used_pairs,EXCLUDED.used_pairs);

CREATE FUNCTION protect_binary_daily_cap_usage() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF pg_trigger_depth()>1 THEN
   IF TG_OP='INSERT' THEN RETURN NEW; END IF;
   IF TG_OP='UPDATE' AND NEW.user_id=OLD.user_id AND NEW.pairing_day=OLD.pairing_day
     AND NEW.used_pairs>=OLD.used_pairs THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Daily cap usage can change only through a recorded pair event.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER binary_daily_cap_usage_protect BEFORE INSERT OR UPDATE OR DELETE ON binary_daily_cap_usage
 FOR EACH ROW EXECUTE FUNCTION protect_binary_daily_cap_usage();
CREATE TRIGGER binary_daily_cap_usage_no_truncate BEFORE TRUNCATE ON binary_daily_cap_usage
 FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();
CREATE FUNCTION accumulate_binary_daily_cap_usage() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE applied BIGINT;
BEGIN
 INSERT INTO binary_daily_cap_usage(user_id,pairing_day,used_pairs)
 VALUES(NEW.recipient_user_id,NEW.pairing_day,NEW.payable_pairs::bigint+NEW.inactive_flashout_pairs::bigint)
 ON CONFLICT(user_id,pairing_day) DO UPDATE
 SET used_pairs=binary_daily_cap_usage.used_pairs+EXCLUDED.used_pairs,updated_at=clock_timestamp()
 RETURNING used_pairs INTO applied;
 IF applied IS DISTINCT FROM NEW.closing_daily_pairing_count::bigint
 THEN RAISE EXCEPTION 'Daily cap usage does not match the immutable pair event.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER binary_pair_events_accumulate_daily_cap AFTER INSERT ON binary_pair_events
 FOR EACH ROW EXECUTE FUNCTION accumulate_binary_daily_cap_usage();
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
  -- A delayed older-day transaction must never reset another day's allowance.
  SELECT COALESCE((SELECT used_pairs FROM binary_daily_cap_usage
    WHERE user_id=NEW.recipient_user_id AND pairing_day=event_pairing_day),0)::integer
  INTO used_today;
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


CREATE OR REPLACE FUNCTION validate_binary_pair_event_closing_state() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE profile RECORD; recorded_usage BIGINT; cached_usage BIGINT;
BEGIN
 SELECT left_points,right_points,daily_pairing_count,daily_pairing_date INTO profile
 FROM reseller_profiles WHERE user_id=NEW.recipient_user_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Package Binary closing profile is missing.' USING ERRCODE='23514'; END IF;
 SELECT used_pairs INTO recorded_usage FROM binary_daily_cap_usage
   WHERE user_id=NEW.recipient_user_id AND pairing_day=NEW.pairing_day;
 SELECT COALESCE((SELECT used_pairs FROM binary_daily_cap_usage
   WHERE user_id=NEW.recipient_user_id AND pairing_day=profile.daily_pairing_date),0) INTO cached_usage;
 IF profile.left_points IS DISTINCT FROM NEW.closing_left_points
   OR profile.right_points IS DISTINCT FROM NEW.closing_right_points
   OR recorded_usage IS DISTINCT FROM NEW.closing_daily_pairing_count::bigint
   OR profile.daily_pairing_date IS NULL OR profile.daily_pairing_date<NEW.pairing_day
   OR profile.daily_pairing_count::bigint IS DISTINCT FROM cached_usage
 THEN RAISE EXCEPTION 'Package Binary event closing carryover/cap state was not applied atomically.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION protect_binary_daily_cap_usage() FROM PUBLIC;
REVOKE ALL ON FUNCTION accumulate_binary_daily_cap_usage() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_binary_pair_event_closing_state() FROM PUBLIC;
COMMIT;
