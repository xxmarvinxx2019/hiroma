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
    IF NEW.rule_version = 'product-binary-weekly-v1' THEN
      IF NEW.is_pair_overflow OR NEW.source_event_kind IS DISTINCT FROM 'product_binary_week'
         OR NEW.source_user_id IS NOT NULL OR NEW.points IS NOT NULL
         OR NOT EXISTS (
           SELECT 1 FROM product_binary_pool_allocations a
           JOIN product_binary_pool_weeks w USING (week_start)
           WHERE w.closed_at IS NOT NULL AND a.commission_id = NEW.id
             AND a.recipient_user_id = NEW.user_id
             AND to_char(a.week_start, 'YYYY-MM-DD') = NEW.source_event_id
             AND a.amount_centavos::numeric = NEW.amount * 100
         ) THEN
        RAISE EXCEPTION 'Product Binary commission has no exact weekly allocation.' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
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

CREATE FUNCTION public.credit_product_binary_pool_allocation(target_week date, member_id text)
RETURNS boolean
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  allocation public.product_binary_pool_allocations;
  credit_id text;
  credit_amount numeric;
  week_key text := to_char(target_week, 'YYYY-MM-DD');
BEGIN
  SELECT a.* INTO STRICT allocation
  FROM product_binary_pool_allocations a JOIN product_binary_pool_weeks w USING (week_start)
  WHERE a.week_start = target_week AND a.recipient_user_id = member_id AND w.closed_at IS NOT NULL
  FOR UPDATE OF a;

  IF allocation.commission_id IS NOT NULL OR allocation.amount_centavos = 0 THEN
    RETURN false;
  END IF;

  credit_id := gen_random_uuid()::text;
  credit_amount := allocation.amount_centavos::numeric / 100;

  INSERT INTO commissions (
    id, event_key, source_event_kind, source_event_id, rule_version,
    user_id, type, amount, is_pair_overflow, created_at
  ) VALUES (
    credit_id, 'product-binary-week:' || week_key || ':' || member_id,
    'product_binary_week', week_key, 'product-binary-weekly-v1',
    member_id, 'sponsor_point', credit_amount, false, CURRENT_TIMESTAMP
  );

  UPDATE product_binary_pool_allocations SET commission_id = credit_id
  WHERE week_start = target_week AND recipient_user_id = member_id;

  IF NOT EXISTS (
    SELECT 1 FROM wallet_ledger_entries
    WHERE commission_id = credit_id AND entry_type = 'commission_credit'
      AND balance_delta = credit_amount AND total_earned_delta = credit_amount
  ) THEN
    RAISE EXCEPTION 'Weekly Product Binary allocation did not create an exact wallet credit.';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_product_binary_pool_allocation(date,text) FROM PUBLIC;
