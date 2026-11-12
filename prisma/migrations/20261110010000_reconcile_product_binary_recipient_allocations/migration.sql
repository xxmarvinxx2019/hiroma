CREATE OR REPLACE FUNCTION public.verify_product_binary_week_readiness(target_week date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  w public.product_binary_pool_weeks;
  blocker text;
  available numeric;
  recorded_budget numeric;
  recorded_pairs numeric;
  allocated numeric;
  allocation_pairs numeric;
BEGIN
  SELECT * INTO STRICT w FROM public.product_binary_pool_weeks
  WHERE week_start = target_week FOR UPDATE;
  IF w.closed_at IS NULL OR w.released_at IS NOT NULL THEN
    RETURN 'Week must be finalized and unreleased.';
  END IF;

  SELECT COALESCE(SUM(COALESCE(o.funded_units, e.eligible_units)::numeric), 0) * 500
  INTO recorded_budget
  FROM public.product_binary_pool_orders o JOIN public.product_binary_order_events e ON e.id=o.order_event_id
  WHERE o.week_start=target_week;
  SELECT COALESCE(SUM(e.payable_pairs::numeric),0) INTO recorded_pairs
  FROM public.product_binary_pool_pairs p JOIN public.product_binary_pair_events e ON e.id=p.pair_event_id
  WHERE p.week_start=target_week;
  SELECT COALESCE(SUM(a.amount_centavos),0), COALESCE(SUM(a.payable_pairs),0)
  INTO allocated, allocation_pairs FROM public.product_binary_pool_allocations a WHERE a.week_start=target_week;

  IF recorded_budget <> w.pool_centavos OR recorded_pairs <> w.total_pairs
     OR allocated <> w.allocated_centavos OR allocation_pairs <> recorded_pairs
     OR allocated > recorded_budget THEN
    blocker := 'Recorded funding, pairs, and finalized allocations do not reconcile.';
  ELSIF EXISTS (SELECT 1 FROM public.product_binary_pool_allocations
    WHERE week_start=target_week AND commission_id IS NOT NULL) THEN
    blocker := 'The week already contains wallet credits.';
  ELSIF EXISTS (
    WITH expected_pairs AS (
      SELECT e.recipient_user_id, SUM(e.payable_pairs::numeric) AS pairs
      FROM public.product_binary_pool_pairs p
      JOIN public.product_binary_pair_events e ON e.id = p.pair_event_id
      WHERE p.week_start = target_week AND e.payable_pairs > 0
      GROUP BY e.recipient_user_id
    ), actual AS (
      SELECT recipient_user_id, payable_pairs, amount_centavos
      FROM public.product_binary_pool_allocations WHERE week_start = target_week
    )
    SELECT 1 FROM expected_pairs e FULL JOIN actual a USING (recipient_user_id)
    WHERE e.pairs IS DISTINCT FROM a.payable_pairs::numeric
       OR a.amount_centavos::numeric IS DISTINCT FROM
          div(e.pairs * LEAST(recorded_budget, recorded_pairs * w.max_rate_centavos), NULLIF(recorded_pairs, 0))
  ) THEN
    blocker := 'One or more recipient allocations do not match the finalized pair records.';
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));
    SELECT COALESCE(SUM(GREATEST(0, remaining_amount-public.product_binary_inventory_earmark(order_id))),0)
    INTO available FROM public.product_binary_funding_lots WHERE allocated_at<=CURRENT_TIMESTAMP;
    IF allocated > GREATEST(0, available-public.product_binary_week_funding_held(target_week))*100 THEN
      blocker := 'Available funded reserve is insufficient.';
    END IF;
  END IF;
  UPDATE public.product_binary_pool_weeks
  SET readiness_checked_at=clock_timestamp(), readiness_blocker=blocker WHERE week_start=target_week;
  RETURN blocker;
END;
$$;
REVOKE ALL ON FUNCTION public.verify_product_binary_week_readiness(date) FROM PUBLIC;
