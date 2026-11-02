BEGIN;
SELECT pg_advisory_xact_lock(hashtext('package-binary-product-reward-policy'));
CREATE TABLE package_binary_carryover_policies (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),revision BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
 package_id TEXT NOT NULL REFERENCES packages(id),effective_day DATE NOT NULL,enabled BOOLEAN NOT NULL,
 max_points INTEGER NOT NULL CHECK(max_points>0),cap_policy_id UUID UNIQUE REFERENCES package_binary_cap_policies(id),
 created_by TEXT REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX package_binary_carryover_effective_idx ON package_binary_carryover_policies(package_id,effective_day DESC,revision DESC);
INSERT INTO package_binary_carryover_policies(package_id,effective_day,enabled,max_points)
 SELECT id,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date,true,180000 FROM packages;
INSERT INTO audit_logs(id,user_name,user_role,activity_type,category,description,metadata,risk_level,status)
 VALUES(gen_random_uuid()::text,'Database migration','system','package_binary_carryover_cap_initialized','commission',
 'Enabled 180000 unmatched points per leg for every existing package. Existing point lots and balances are preserved.',
 jsonb_build_object('migration','20261102100000_package_binary_unmatched_balance_cap','enabled',true,'max_points',180000,'existing_excess','preserved; incoming unmatched volume rejected until balance drops'), 'high','completed');
CREATE FUNCTION protect_package_binary_carryover_policy() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Carryover policy versions are immutable.' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('package-binary-product-reward-policy'));
 IF pg_trigger_depth()>1 AND NEW.created_by IS NULL AND NEW.cap_policy_id IS NULL AND NEW.enabled AND NEW.max_points=180000
  AND NEW.effective_day=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
  AND NOT EXISTS(SELECT 1 FROM package_binary_carryover_policies WHERE package_id=NEW.package_id) THEN RETURN NEW; END IF;
 IF NEW.effective_day<=(clock_timestamp() AT TIME ZONE 'Asia/Manila')::date THEN RAISE EXCEPTION 'Carryover policy must start at a future Philippine midnight.' USING ERRCODE='23514'; END IF;
 IF NEW.created_by IS NULL OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.created_by AND u.role::text='admin' AND u.status::text='active' AND COALESCE((to_jsonb(u)->>'is_staff')::boolean,false)=false) THEN RAISE EXCEPTION 'An active owner administrator is required.' USING ERRCODE='23514'; END IF;
 IF NEW.enabled AND NEW.max_points<(SELECT ROUND(pairing_bonus_value)::integer FROM packages WHERE id=NEW.package_id) THEN RAISE EXCEPTION 'Unmatched point limit must allow at least one pair.' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM package_binary_cap_policies p WHERE p.id=NEW.cap_policy_id AND p.package_id=NEW.package_id AND p.effective_day=NEW.effective_day AND p.created_by=NEW.created_by) THEN RAISE EXCEPTION 'Carryover policy requires its matching scheduled cap version.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER package_binary_carryover_protect BEFORE INSERT OR UPDATE OR DELETE ON package_binary_carryover_policies FOR EACH ROW EXECUTE FUNCTION protect_package_binary_carryover_policy();
CREATE TRIGGER package_binary_carryover_no_truncate BEFORE TRUNCATE ON package_binary_carryover_policies FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();
CREATE FUNCTION verify_package_binary_carryover_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.created_by IS NULL AND NEW.cap_policy_id IS NULL AND EXISTS(SELECT 1 FROM audit_logs WHERE activity_type='package_binary_carryover_cap_initialized' AND metadata->>'carryover_policy_id'=NEW.id::text) THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM audit_logs WHERE activity_type='package_binary_cap_policy_scheduled' AND metadata->>'carryover_policy_id'=NEW.id::text AND metadata->>'actor_id'=NEW.created_by) THEN RAISE EXCEPTION 'Carryover policy requires its atomic owner audit record.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER package_binary_carryover_audit AFTER INSERT ON package_binary_carryover_policies DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_package_binary_carryover_audit();
CREATE FUNCTION initialize_package_binary_carryover() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE version_id UUID;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('package-binary-product-reward-policy'));
 INSERT INTO package_binary_carryover_policies(package_id,effective_day,enabled,max_points)
 VALUES(NEW.id,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date,true,180000) RETURNING id INTO version_id;
 INSERT INTO audit_logs(id,user_name,user_role,activity_type,category,description,metadata,risk_level,status)
 VALUES(gen_random_uuid()::text,'Database trigger','system','package_binary_carryover_cap_initialized','commission','New package starts with 180000 unmatched points per leg.',
 jsonb_build_object('package_id',NEW.id,'carryover_policy_id',version_id::text,'enabled',true,'max_points',180000),'high','completed');
 RETURN NEW;
END $$;
CREATE TRIGGER packages_initialize_carryover AFTER INSERT ON packages FOR EACH ROW EXECUTE FUNCTION initialize_package_binary_carryover();
REVOKE ALL ON FUNCTION initialize_package_binary_carryover() FROM PUBLIC;
CREATE FUNCTION package_binary_cap_state_v2(package_key TEXT,member_key TEXT,at_time TIMESTAMPTZ)
RETURNS TABLE(enabled BOOLEAN,cap INTEGER,mode TEXT,policy_id TEXT,cutoff TEXT,session INTEGER,session_cap INTEGER,used_today BIGINT,used_session BIGINT,carryover_enabled BOOLEAN,carryover_limit INTEGER,carryover_policy_id TEXT)
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT s.*,COALESCE(c.enabled,NOT EXISTS(SELECT 1 FROM package_binary_carryover_policies h WHERE h.package_id=package_key)),COALESCE(c.max_points,180000),c.id::text
 FROM package_binary_cap_state(package_key,member_key,at_time) s
 LEFT JOIN LATERAL(SELECT p.* FROM package_binary_carryover_policies p WHERE p.package_id=package_key AND p.effective_day<=(at_time AT TIME ZONE 'Asia/Manila')::date ORDER BY p.effective_day DESC,p.revision DESC LIMIT 1)c ON true
$$;
ALTER TABLE binary_pair_events
 ADD COLUMN carryover_policy_id UUID REFERENCES package_binary_carryover_policies(id),
 ADD COLUMN carryover_cap_enabled BOOLEAN, ADD COLUMN carryover_cap_points INTEGER,
 ADD COLUMN session_flushed_points INTEGER, ADD COLUMN carryover_flushed_points INTEGER,
 ADD CONSTRAINT binary_pair_event_source_flush_parts CHECK(carryover_cap_enabled IS NULL OR
 (session_flushed_points IS NOT NULL AND carryover_flushed_points IS NOT NULL AND session_flushed_points>=0 AND carryover_flushed_points>=0
 AND session_flushed_points+carryover_flushed_points=source_points_flushed));
-- CARRYOVER_VALIDATOR_BEGIN
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
  available_left_points BIGINT;
  available_right_points BIGINT;
  expected_package_id TEXT;
  expected_package_name TEXT;
  expected_points_per_pair INTEGER;
  expected_user_status TEXT;
  expected_cap_enabled BOOLEAN;
  expected_cap_limit INTEGER;
  event_pairing_day DATE;
  policy_state RECORD;
  used_today INTEGER;
  used_session INTEGER;
  session_number INTEGER;
  session_limit INTEGER;
  remaining_slots INTEGER;
  potential_pairs INTEGER;
  accepted_source_points INTEGER;
  session_accepted_source_points INTEGER;
  planned_completed_pairs INTEGER;
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

  event_pairing_day := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date;
  SELECT COALESCE((SELECT used_pairs FROM binary_daily_cap_usage
    WHERE user_id=NEW.recipient_user_id AND pairing_day=event_pairing_day),0)::integer INTO used_today;
  SELECT * INTO policy_state FROM package_binary_cap_state_v2(expected_package_id,NEW.recipient_user_id,CURRENT_TIMESTAMP);
  expected_cap_enabled:=policy_state.enabled;expected_cap_limit:=policy_state.cap;
  used_today:=policy_state.used_today;used_session:=policy_state.used_session;
  session_number:=policy_state.session;session_limit:=policy_state.session_cap;
  remaining_slots := CASE WHEN expected_cap_enabled THEN
    GREATEST(0,LEAST(expected_cap_limit-used_today,session_limit-used_session)) ELSE NULL END;
  potential_pairs := LEAST(current_left_points::bigint+CASE WHEN NEW.source_leg='left' THEN NEW.source_points ELSE 0 END,
    current_right_points::bigint+CASE WHEN NEW.source_leg='right' THEN NEW.source_points ELSE 0 END)/expected_points_per_pair;
  accepted_source_points := NEW.source_points;
  IF remaining_slots IS NOT NULL AND potential_pairs>=remaining_slots THEN
    accepted_source_points := LEAST(NEW.source_points,GREATEST(0,remaining_slots*expected_points_per_pair
      -CASE WHEN NEW.source_leg='left' THEN current_left_points ELSE current_right_points END));
  END IF;
  session_accepted_source_points:=accepted_source_points;
  planned_completed_pairs:=LEAST(potential_pairs,COALESCE(remaining_slots,potential_pairs));
  IF policy_state.carryover_enabled THEN
    accepted_source_points:=LEAST(accepted_source_points,GREATEST(0,policy_state.carryover_limit::bigint
      -CASE WHEN NEW.source_leg='left' THEN current_left_points ELSE current_right_points END
      +planned_completed_pairs::bigint*expected_points_per_pair))::integer;
  END IF;
  NEW.carryover_policy_id:=policy_state.carryover_policy_id::uuid;
  NEW.carryover_cap_enabled:=policy_state.carryover_enabled;
  NEW.carryover_cap_points:=CASE WHEN policy_state.carryover_enabled THEN policy_state.carryover_limit ELSE NULL END;
  NEW.session_flushed_points:=NEW.source_points-session_accepted_source_points;
  NEW.carryover_flushed_points:=session_accepted_source_points-accepted_source_points;
  IF NEW.source_points_flushed IS DISTINCT FROM NEW.source_points-accepted_source_points THEN
    RAISE EXCEPTION 'Package Binary source flush does not match locked session allowance.' USING ERRCODE='23514';
  END IF;

  -- The event is inserted before the application mutates this locked profile,
  -- so an attacker cannot fabricate an opposite-leg opening balance and use it
  -- to mint a pair. This specifically rejects a 0/0 profile claiming 0/600 as
  -- its opening state for a new 600-point left-leg source.
  available_left_points := NEW."opening_left_points"::bigint
    + CASE WHEN NEW."source_leg" = 'left' THEN accepted_source_points ELSE 0 END;
  available_right_points := NEW."opening_right_points"::bigint
    + CASE WHEN NEW."source_leg" = 'right' THEN accepted_source_points ELSE 0 END;

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

  expected_within_cap := CASE
    WHEN expected_cap_enabled
      THEN LEAST(NEW."completed_pairs", GREATEST(0, expected_cap_limit - used_today))
    ELSE NEW."completed_pairs"
  END;
  IF expected_within_cap IS DISTINCT FROM NEW.completed_pairs
    OR (remaining_slots IS NOT NULL AND NEW.completed_pairs>remaining_slots) THEN
    RAISE EXCEPTION 'Package Binary session cap exceeded.' USING ERRCODE='23514';
  END IF;
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
  NEW.cap_policy_id:=policy_state.policy_id::uuid;
  NEW.cap_mode:=policy_state.mode;
  NEW.cap_cutoff:=policy_state.cutoff;
  NEW.cap_session := session_number;
  NEW.opening_session_pairing_count := used_session;
  NEW.closing_session_pairing_count := used_session+expected_within_cap;
  NEW."pairing_day" := event_pairing_day;
  NEW."opening_daily_pairing_count" := used_today;
  NEW."closing_daily_pairing_count" := used_today + expected_within_cap;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


REVOKE ALL ON FUNCTION protect_package_binary_carryover_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION verify_package_binary_carryover_audit() FROM PUBLIC;
COMMIT;
