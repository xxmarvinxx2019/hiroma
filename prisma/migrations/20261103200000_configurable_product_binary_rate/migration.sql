CREATE FUNCTION public.product_binary_pair_amount()
RETURNS numeric LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE((SELECT value::numeric FROM system_settings WHERE key='product_binary_pair_amount'),5)
$$;

ALTER TABLE system_settings ADD CONSTRAINT product_binary_pair_amount_valid
 CHECK (CASE WHEN key = 'product_binary_pair_amount' THEN
   value::numeric BETWEEN 0.5 AND 20 AND mod(value::numeric,0.5)=0 ELSE true END);

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
  required_pu_per_leg INTEGER;
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
  END IF;

  SELECT COALESCE((SELECT value::integer FROM public.system_settings WHERE key = 'product_binary_pu_per_leg'), 2) INTO required_pu_per_leg;
  expected_pair_rate_amount := public.product_binary_pair_amount();
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
     OR NEW."completed_pairs" IS DISTINCT FROM LEAST(available_left_pu, available_right_pu) / required_pu_per_leg
     OR NEW."closing_left_pu" IS DISTINCT FROM available_left_pu - NEW."completed_pairs" * required_pu_per_leg
     OR NEW."closing_right_pu" IS DISTINCT FROM available_right_pu - NEW."completed_pairs" * required_pu_per_leg
     OR NEW."closing_lifetime_pairs" IS DISTINCT FROM current_lifetime_pairs + NEW."completed_pairs"
     OR NEW."closing_lifetime_payable" IS DISTINCT FROM current_lifetime_payable + NEW."payable_pairs"
     OR NEW."closing_lifetime_flashout" IS DISTINCT FROM current_lifetime_flashout
          + NEW."cap_flashout_pairs" + NEW."inactive_flashout_pairs" THEN
    RAISE EXCEPTION 'Product Binary pair does not reconcile to locked carryover and exact source PU.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

