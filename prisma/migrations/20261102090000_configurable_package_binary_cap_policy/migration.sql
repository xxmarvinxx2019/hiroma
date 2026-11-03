BEGIN;
SELECT pg_advisory_xact_lock(hashtext('package-binary-product-reward-policy'));
CREATE TABLE package_binary_cap_policies (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), revision BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
 package_id TEXT NOT NULL REFERENCES packages(id), effective_day DATE NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN('two_sessions','daily_anytime')),
 enabled BOOLEAN NOT NULL DEFAULT true, daily_limit INTEGER NOT NULL CHECK(daily_limit BETWEEN 1 AND 10000),
 first_limit INTEGER, cutoff_minute INTEGER, created_by TEXT REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK((mode='daily_anytime' AND first_limit IS NULL AND cutoff_minute IS NULL) OR
 (mode='two_sessions' AND first_limit IS NOT NULL AND cutoff_minute IS NOT NULL AND first_limit>0 AND first_limit<daily_limit AND cutoff_minute BETWEEN 1 AND 1439))
);
CREATE INDEX package_binary_cap_policies_effective_idx ON package_binary_cap_policies(package_id,effective_day DESC,revision DESC);
INSERT INTO package_binary_cap_policies(package_id,effective_day,mode,enabled,daily_limit,first_limit,cutoff_minute)
 SELECT id,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date,
 CASE WHEN daily_binary_pair_cap<2 THEN 'daily_anytime' ELSE 'two_sessions' END,
 binary_pair_cap_enabled,daily_binary_pair_cap,
 CASE WHEN daily_binary_pair_cap>=2 THEN daily_binary_pair_cap/2 ELSE NULL END,
 CASE WHEN daily_binary_pair_cap>=2 THEN 780 ELSE NULL END FROM packages;
CREATE FUNCTION protect_package_binary_cap_policy() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Cap policy versions are immutable.' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('package-binary-product-reward-policy'));
 IF NEW.effective_day<=(clock_timestamp() AT TIME ZONE 'Asia/Manila')::date THEN
  RAISE EXCEPTION 'Cap policy must start at a future Philippine midnight.' USING ERRCODE='23514'; END IF;
 IF NEW.created_by IS NULL OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.created_by AND u.role::text='admin' AND u.status::text='active'
  AND COALESCE((to_jsonb(u)->>'is_staff')::boolean,false)=false) THEN
  RAISE EXCEPTION 'An active owner administrator is required.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER package_binary_cap_policy_protect BEFORE INSERT OR UPDATE OR DELETE ON package_binary_cap_policies
 FOR EACH ROW EXECUTE FUNCTION protect_package_binary_cap_policy();
CREATE TRIGGER package_binary_cap_policy_no_truncate BEFORE TRUNCATE ON package_binary_cap_policies
 FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();
CREATE FUNCTION verify_package_binary_cap_policy_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM audit_logs WHERE activity_type='package_binary_cap_policy_scheduled'
  AND metadata->>'policy_id'=NEW.id::text AND metadata->>'actor_id'=NEW.created_by) THEN
  RAISE EXCEPTION 'Cap policy requires its atomic owner audit record.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER package_binary_cap_policy_audit AFTER INSERT ON package_binary_cap_policies
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_package_binary_cap_policy_audit();
CREATE FUNCTION reject_legacy_package_cap_edit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.daily_binary_pair_cap:=10;NEW.binary_pair_cap_enabled:=true;RETURN NEW;END IF;
 IF NEW.daily_binary_pair_cap IS DISTINCT FROM OLD.daily_binary_pair_cap OR NEW.binary_pair_cap_enabled IS DISTINCT FROM OLD.binary_pair_cap_enabled THEN
  RAISE EXCEPTION 'Schedule Package Binary cap changes in Admin Settings with Security PIN.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER packages_protect_binary_cap BEFORE INSERT OR UPDATE ON packages
 FOR EACH ROW EXECUTE FUNCTION reject_legacy_package_cap_edit();
-- POLICY_LOOKUP_BEGIN
CREATE FUNCTION package_binary_cap_state(package_key TEXT, member_key TEXT, at_time TIMESTAMPTZ)
RETURNS TABLE(enabled BOOLEAN,cap INTEGER,mode TEXT,policy_id TEXT,cutoff TEXT,session INTEGER,session_cap INTEGER,used_today BIGINT,used_session BIGINT)
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE chosen RECORD; pairing_date DATE; minute_now INTEGER; first_cap INTEGER; cutoff_at INTEGER; total_recorded BIGINT; session_recorded BIGINT;
BEGIN
 pairing_date:=(at_time AT TIME ZONE 'Asia/Manila')::date;
 SELECT p.* INTO chosen FROM package_binary_cap_policies p WHERE p.package_id=package_key AND p.effective_day<=pairing_date ORDER BY p.effective_day DESC,p.revision DESC LIMIT 1;
 IF FOUND THEN
  enabled:=chosen.enabled;cap:=chosen.daily_limit;mode:=chosen.mode;policy_id:=chosen.id::text;first_cap:=chosen.first_limit;cutoff_at:=chosen.cutoff_minute;
 ELSE
  SELECT COALESCE(p.binary_pair_cap_enabled,true),GREATEST(1,COALESCE(p.daily_binary_pair_cap,10)) INTO enabled,cap FROM packages p WHERE p.id=package_key;
  mode:='two_sessions';first_cap:=GREATEST(1,cap/2);cutoff_at:=780;policy_id:=NULL;
 END IF;
 IF cap IS NULL THEN RAISE EXCEPTION 'Package Binary cap package is missing.'; END IF;
 SELECT COALESCE((SELECT d.used_pairs FROM binary_daily_cap_usage d WHERE d.user_id=member_key AND d.pairing_day=pairing_date),0) INTO used_today;
 IF mode='daily_anytime' THEN session:=0;session_cap:=cap;used_session:=used_today;cutoff:=NULL;
 ELSE
  minute_now:=extract(hour FROM at_time AT TIME ZONE 'Asia/Manila')::int*60+extract(minute FROM at_time AT TIME ZONE 'Asia/Manila')::int;
  session:=CASE WHEN minute_now<cutoff_at THEN 1 ELSE 2 END;
  session_cap:=CASE WHEN session=1 THEN first_cap ELSE GREATEST(1,cap-first_cap) END;
  cutoff:=lpad((cutoff_at/60)::text,2,'0')||':'||lpad((cutoff_at%60)::text,2,'0');
  SELECT COALESCE(SUM(e.payable_pairs+e.inactive_flashout_pairs),0),
   COALESCE(SUM(e.payable_pairs+e.inactive_flashout_pairs) FILTER(WHERE COALESCE(e.cap_session,
    CASE WHEN extract(hour FROM e.created_at AT TIME ZONE 'Asia/Manila')*60+extract(minute FROM e.created_at AT TIME ZONE 'Asia/Manila')<cutoff_at THEN 1 ELSE 2 END)=session),0)
  INTO total_recorded,session_recorded FROM binary_pair_events e WHERE e.recipient_user_id=member_key AND e.pairing_day=pairing_date;
  used_session:=session_recorded+GREATEST(0,used_today-total_recorded);
 END IF;
 RETURN NEXT;
END $$;
-- POLICY_LOOKUP_END
ALTER TABLE binary_pair_events ADD COLUMN cap_policy_id UUID REFERENCES package_binary_cap_policies(id), ADD COLUMN cap_mode TEXT, ADD COLUMN cap_cutoff TEXT;
ALTER TABLE binary_pair_events DROP CONSTRAINT binary_pair_events_session_check;
ALTER TABLE binary_pair_events ADD CONSTRAINT binary_pair_events_session_check CHECK(source_points_flushed>=0 AND source_points_flushed<=source_points AND (cap_session IS NULL OR (cap_session IN(0,1,2) AND opening_session_pairing_count>=0 AND closing_session_pairing_count>=opening_session_pairing_count)));
-- REPLACE_VALIDATORS
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
  policy_state RECORD;
  used_today INTEGER;
  used_session INTEGER;
  session_number INTEGER;
  session_limit INTEGER;
  remaining_slots INTEGER;
  potential_pairs INTEGER;
  accepted_source_points INTEGER;
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
  SELECT * INTO policy_state FROM package_binary_cap_state(expected_package_id,NEW.recipient_user_id,CURRENT_TIMESTAMP);
  expected_cap_enabled:=policy_state.enabled;expected_cap_limit:=policy_state.cap;
  used_today:=policy_state.used_today;used_session:=policy_state.used_session;
  session_number:=policy_state.session;session_limit:=policy_state.session_cap;
  remaining_slots := CASE WHEN expected_cap_enabled THEN
    GREATEST(0,LEAST(expected_cap_limit-used_today,session_limit-used_session)) ELSE NULL END;
  potential_pairs := LEAST(current_left_points+CASE WHEN NEW.source_leg='left' THEN NEW.source_points ELSE 0 END,
    current_right_points+CASE WHEN NEW.source_leg='right' THEN NEW.source_points ELSE 0 END)/expected_points_per_pair;
  accepted_source_points := NEW.source_points;
  IF remaining_slots IS NOT NULL AND potential_pairs>=remaining_slots THEN
    accepted_source_points := LEAST(NEW.source_points,GREATEST(0,remaining_slots*expected_points_per_pair
      -CASE WHEN NEW.source_leg='left' THEN current_left_points ELSE current_right_points END));
  END IF;
  IF NEW.source_points_flushed IS DISTINCT FROM NEW.source_points-accepted_source_points THEN
    RAISE EXCEPTION 'Package Binary source flush does not match locked session allowance.' USING ERRCODE='23514';
  END IF;

  -- The event is inserted before the application mutates this locked profile,
  -- so an attacker cannot fabricate an opposite-leg opening balance and use it
  -- to mint a pair. This specifically rejects a 0/0 profile claiming 0/600 as
  -- its opening state for a new 600-point left-leg source.
  available_left_points := NEW."opening_left_points"
    + CASE WHEN NEW."source_leg" = 'left' THEN accepted_source_points ELSE 0 END;
  available_right_points := NEW."opening_right_points"
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


CREATE OR REPLACE FUNCTION validate_binary_session_closing_state() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actual_usage BIGINT; daily_usage BIGINT; recorded_total BIGINT;
 credited_points BIGINT; consumed_left BIGINT; consumed_right BIGINT;
 remaining_left BIGINT; remaining_right BIGINT;
BEGIN
 SELECT used_session INTO actual_usage FROM package_binary_cap_state(NEW.recipient_package_id,NEW.recipient_user_id,CURRENT_TIMESTAMP);
 IF actual_usage IS DISTINCT FROM NEW.closing_session_pairing_count::bigint THEN
  RAISE EXCEPTION 'Package Binary closing session usage was not applied atomically.' USING ERRCODE='23514';
 END IF;
 SELECT COALESCE(SUM(original_points),0) INTO credited_points FROM binary_point_lots
 WHERE recipient_user_id=NEW.recipient_user_id AND source_kind=NEW.source_kind
   AND source_event_id=NEW.source_event_id AND leg=NEW.source_leg;
 SELECT COALESCE(SUM(c.points) FILTER(WHERE lot.leg='left'),0),
   COALESCE(SUM(c.points) FILTER(WHERE lot.leg='right'),0)
 INTO consumed_left,consumed_right FROM binary_point_consumptions c
 JOIN binary_point_lots lot ON lot.id=c.point_lot_id WHERE c.binary_pair_event_id=NEW.id;
 SELECT COALESCE(SUM(remaining_points) FILTER(WHERE leg='left'),0),
   COALESCE(SUM(remaining_points) FILTER(WHERE leg='right'),0)
 INTO remaining_left,remaining_right FROM binary_point_lots WHERE recipient_user_id=NEW.recipient_user_id;
 IF credited_points IS DISTINCT FROM (NEW.source_points-NEW.source_points_flushed)::bigint
   OR consumed_left IS DISTINCT FROM NEW.consumed_left_points::bigint
   OR consumed_right IS DISTINCT FROM NEW.consumed_right_points::bigint
   OR remaining_left IS DISTINCT FROM NEW.closing_left_points::bigint
   OR remaining_right IS DISTINCT FROM NEW.closing_right_points::bigint THEN
  RAISE EXCEPTION 'Package Binary accepted/flushed volume does not reconcile to point lots.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION protect_package_binary_cap_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION verify_package_binary_cap_policy_audit() FROM PUBLIC;
REVOKE ALL ON FUNCTION reject_legacy_package_cap_edit() FROM PUBLIC;
COMMIT;
