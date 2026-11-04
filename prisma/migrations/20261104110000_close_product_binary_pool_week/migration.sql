CREATE FUNCTION public.close_product_binary_pool_week(target_week date)
RETURNS public.product_binary_pool_weeks
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  week_row public.product_binary_pool_weeks;
  budget bigint;
  pairs bigint;
  distributable numeric;
  allocated bigint;
BEGIN
  SELECT * INTO STRICT week_row
  FROM product_binary_pool_weeks WHERE week_start = target_week FOR UPDATE;

  IF week_row.closed_at IS NOT NULL THEN
    RETURN week_row;
  END IF;
  IF clock_timestamp() < ((target_week + 7)::timestamp AT TIME ZONE 'Asia/Manila') THEN
    RAISE EXCEPTION 'Product Binary pool week has not reached its Manila cutoff.';
  END IF;

  SELECT (COALESCE(SUM(e.eligible_units::bigint), 0) * 500)::bigint INTO budget
  FROM product_binary_pool_orders o
  JOIN product_binary_order_events e ON e.id = o.order_event_id
  WHERE o.week_start = target_week;

  IF EXISTS (
    SELECT 1 FROM product_binary_pool_pairs p
    JOIN product_binary_pair_events e ON e.id = p.pair_event_id
    WHERE p.week_start = target_week AND e.normal_commission_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A Product Binary pair in the pool already has a per-order commission.';
  END IF;

  SELECT COALESCE(SUM(e.payable_pairs::bigint), 0)::bigint INTO pairs
  FROM product_binary_pool_pairs p
  JOIN product_binary_pair_events e ON e.id = p.pair_event_id
  WHERE p.week_start = target_week;

  distributable := LEAST(budget::numeric, pairs::numeric * week_row.max_rate_centavos);

  IF pairs > 0 THEN
    INSERT INTO product_binary_pool_allocations (week_start, recipient_user_id, payable_pairs, amount_centavos)
    SELECT target_week, e.recipient_user_id, SUM(e.payable_pairs::bigint),
      div(SUM(e.payable_pairs::bigint) * distributable, pairs)::bigint
    FROM product_binary_pool_pairs p
    JOIN product_binary_pair_events e ON e.id = p.pair_event_id
    WHERE p.week_start = target_week AND e.payable_pairs > 0
    GROUP BY e.recipient_user_id;
  END IF;

  SELECT COALESCE(SUM(amount_centavos), 0)::bigint INTO allocated
  FROM product_binary_pool_allocations WHERE week_start = target_week;

  UPDATE product_binary_pool_weeks
  SET closed_at = clock_timestamp(), total_pairs = pairs,
      pool_centavos = budget, allocated_centavos = allocated
  WHERE week_start = target_week RETURNING * INTO week_row;
  RETURN week_row;
END;
$$;

REVOKE ALL ON FUNCTION public.close_product_binary_pool_week(date) FROM PUBLIC;

-- Writers take the same week lock as the closer so late writes cannot change a
-- finalized calculation. The eventual writer must assign late work to an open week.
CREATE FUNCTION public.require_open_product_binary_pool_week()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  closed timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Product Binary pool sources are append-only.';
  END IF;
  SELECT closed_at INTO STRICT closed
  FROM product_binary_pool_weeks WHERE week_start = NEW.week_start FOR UPDATE;
  IF closed IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add sources to a closed Product Binary pool week.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_binary_pool_orders_require_open_week
BEFORE INSERT OR UPDATE OR DELETE ON product_binary_pool_orders
FOR EACH ROW EXECUTE FUNCTION public.require_open_product_binary_pool_week();

CREATE TRIGGER product_binary_pool_pairs_require_open_week
BEFORE INSERT OR UPDATE OR DELETE ON product_binary_pool_pairs
FOR EACH ROW EXECUTE FUNCTION public.require_open_product_binary_pool_week();

REVOKE ALL ON FUNCTION public.require_open_product_binary_pool_week() FROM PUBLIC;
