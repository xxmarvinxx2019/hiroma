BEGIN;

CREATE FUNCTION public.require_fully_funded_product_binary_pool_order()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  eligible_units integer;
BEGIN
  SELECT e.eligible_units INTO STRICT eligible_units
  FROM public.product_binary_order_events e WHERE e.id = NEW.order_event_id;
  IF NEW.funded_units IS DISTINCT FROM eligible_units THEN
    RAISE EXCEPTION 'Product Binary settlement is waiting for reserve funding for all % eligible bottles (funded: %).',
      eligible_units, COALESCE(NEW.funded_units, 0) USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.require_fully_funded_product_binary_pool_order() FROM PUBLIC;
CREATE TRIGGER product_binary_pool_orders_require_full_funding
AFTER INSERT ON public.product_binary_pool_orders
FOR EACH ROW EXECUTE FUNCTION public.require_fully_funded_product_binary_pool_order();

-- Give settlement a persistent policy row to lock when the first order
-- of a week races with an admin rate change.
INSERT INTO public.system_settings(id, key, value, updated_at)
VALUES (gen_random_uuid()::text, 'product_binary_pair_amount', '5', clock_timestamp())
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION public.sync_open_product_binary_week_rate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  current_week date := date_trunc('week', clock_timestamp() AT TIME ZONE 'Asia/Manila')::date;
BEGIN
  UPDATE public.product_binary_pool_weeks w
  SET max_rate_centavos = (NEW.value::numeric * 100)::integer
  WHERE w.week_start = current_week AND w.closed_at IS NULL
    AND w.max_rate_centavos IS DISTINCT FROM (NEW.value::numeric * 100)::integer
    AND NOT EXISTS (
      SELECT 1 FROM public.product_binary_week_preparation p WHERE p.week_start = w.week_start
    );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_open_product_binary_week_rate() FROM PUBLIC;
CREATE TRIGGER product_binary_sync_open_week_rate
AFTER INSERT OR UPDATE OF value ON public.system_settings
FOR EACH ROW WHEN (NEW.key = 'product_binary_pair_amount')
EXECUTE FUNCTION public.sync_open_product_binary_week_rate();

-- Align any currently open week with the saved policy at rollout.
UPDATE public.system_settings SET value = value WHERE key = 'product_binary_pair_amount';

DO $$
DECLARE
  definition text;
  function_name regprocedure;
  release_guard text := '(w.released_at IS NOT NULL OR w.release_started_at IS NOT NULL)';
  retained_amount text := $retained$
    COALESCE((SELECT SUM(a.amount_centavos) FROM public.product_binary_pool_allocations a
      WHERE a.week_start = target_week AND a.retained_at IS NOT NULL AND a.commission_id IS NULL), 0)
  $retained$;
BEGIN
  SELECT pg_get_functiondef('public.queue_product_binary_pool_order(uuid,timestamptz,integer)'::regprocedure)
  INTO definition;
  IF strpos(definition, '  IF NOT EXISTS (') = 0 THEN
    RAISE EXCEPTION 'Expected Product Binary order queue guard is missing.';
  END IF;
  EXECUTE replace(definition, '  IF NOT EXISTS (', $policy_lock$
  PERFORM 1 FROM public.system_settings WHERE key = 'product_binary_pair_amount' FOR SHARE;
  IF NOT EXISTS ($policy_lock$);

  SELECT pg_get_functiondef('public.validate_product_binary_pair_event_entitlement()'::regprocedure)
  INTO definition;
  IF strpos(definition, 'IF expected_user_status <> ''active'' THEN') = 0 THEN
    RAISE EXCEPTION 'Expected Product Binary inactive-pair rule is missing.';
  END IF;
  EXECUTE replace(definition, 'IF expected_user_status <> ''active'' THEN',
    'IF NOT weekly_pool AND expected_user_status <> ''active'' THEN');

  -- An already finalized inactive member keeps the same expiry even when
  -- the scheduled release is delayed or still waiting for reconciliation.
  FOREACH function_name IN ARRAY ARRAY[
    'public.expire_deferred_product_binary_credits()'::regprocedure,
    'public.retain_expired_product_binary_on_reactivation()'::regprocedure
  ]
  LOOP
    SELECT pg_get_functiondef(function_name) INTO definition;
    IF strpos(definition, release_guard) = 0 THEN
      RAISE EXCEPTION 'Expected Product Binary deferred cutoff guard is missing.';
    END IF;
    EXECUTE replace(definition, release_guard, 'w.closed_at IS NOT NULL');
  END LOOP;

  -- The availability helper already excludes amounts retained for this week.
  -- Compare the remaining payout obligation with that available balance.
  SELECT pg_get_functiondef('public.verify_product_binary_week_readiness(date)'::regprocedure)
  INTO definition;
  IF strpos(definition, 'IF w.allocated_centavos >') = 0 THEN
    RAISE EXCEPTION 'Expected Product Binary funding comparison is missing.';
  END IF;
  EXECUTE replace(definition, 'IF w.allocated_centavos >', 'IF w.allocated_centavos - ' || retained_amount || ' >');

  SELECT pg_get_functiondef('public.verify_legacy_product_binary_week_readiness(date)'::regprocedure)
  INTO definition;
  IF strpos(definition, 'IF allocated > GREATEST') = 0 THEN
    RAISE EXCEPTION 'Expected legacy Product Binary funding comparison is missing.';
  END IF;
  EXECUTE replace(definition, 'IF allocated > GREATEST', 'IF allocated - ' || retained_amount || ' > GREATEST');
END $$;

COMMIT;
