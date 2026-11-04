CREATE TABLE public.product_binary_week_funding (
  week_start date PRIMARY KEY REFERENCES public.product_binary_pool_weeks(week_start),
  allocated_centavos bigint NOT NULL CHECK (allocated_centavos >= 0),
  retained_centavos bigint NOT NULL CHECK (retained_centavos >= 0),
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
REVOKE ALL ON public.product_binary_week_funding FROM PUBLIC;

CREATE FUNCTION public.product_binary_week_funding_held(exclude_allocations_for date DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(SUM(f.retained_centavos::numeric +
    CASE WHEN w.released_at IS NULL AND f.week_start IS DISTINCT FROM exclude_allocations_for
      THEN f.allocated_centavos ELSE 0 END), 0) / 100
  FROM public.product_binary_week_funding f
  JOIN public.product_binary_pool_weeks w USING (week_start)
$$;
REVOKE ALL ON FUNCTION public.product_binary_week_funding_held(date) FROM PUBLIC;

CREATE FUNCTION public.reserve_closed_product_binary_week_funding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE available numeric;
BEGIN
  IF OLD.closed_at IS NOT NULL OR NEW.closed_at IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));
  SELECT COALESCE(SUM(GREATEST(0, remaining_amount - public.product_binary_inventory_earmark(order_id))), 0)
  INTO available FROM public.product_binary_funding_lots
  WHERE allocated_at <= CURRENT_TIMESTAMP AND remaining_amount > 0;
  IF NEW.pool_centavos::numeric > (available - public.product_binary_week_funding_held()) * 100 THEN
    RAISE EXCEPTION 'Product Binary weekly close held: pool budget is not fully funded.';
  END IF;
  INSERT INTO public.product_binary_week_funding (week_start, allocated_centavos, retained_centavos)
  VALUES (NEW.week_start, NEW.allocated_centavos, NEW.pool_centavos - NEW.allocated_centavos);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_closed_product_binary_week_funding() FROM PUBLIC;

CREATE TRIGGER product_binary_pool_weeks_reserve_funding
BEFORE UPDATE OF closed_at ON public.product_binary_pool_weeks
FOR EACH ROW EXECUTE FUNCTION public.reserve_closed_product_binary_week_funding();

DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.consume_product_binary_funding(text,numeric,timestamp with time zone)'::regprocedure)
  INTO definition;
  IF position('  IF available < target_amount THEN' IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected Product Binary funding availability check is missing.';
  END IF;
  EXECUTE replace(definition, '  IF available < target_amount THEN', $guard$
  available := available - public.product_binary_week_funding_held((
    SELECT CASE WHEN source_event_kind = 'product_binary_week' THEN source_event_id::date END
    FROM public.commissions WHERE id = target_commission_id
  ));
  IF available < target_amount THEN$guard$);
END $$;
