-- The application runtime reads weekly accounting records and calls the
-- guarded entry points. The migration role owns the underlying records.
ALTER FUNCTION public.queue_product_binary_pool_order(uuid,timestamptz,integer) SECURITY DEFINER;
ALTER FUNCTION public.queue_product_binary_pool_pair() SECURITY DEFINER;
ALTER FUNCTION public.close_product_binary_pool_week(date) SECURITY DEFINER;
ALTER FUNCTION public.credit_product_binary_pool_allocation(date,text) SECURITY DEFINER;

-- Resolve the weekly entitlement against the protected tables even if the
-- calling session has temporary objects with the same names.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.validate_exact_commission_entitlement()'::regprocedure) INTO definition;
  IF position('FROM product_binary_pool_allocations a' IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected weekly Product Binary entitlement validator is missing.';
  END IF;
  EXECUTE replace(
    replace(definition, 'FROM product_binary_pool_allocations a', 'FROM public.product_binary_pool_allocations a'),
    'JOIN product_binary_pool_weeks w', 'JOIN public.product_binary_pool_weeks w'
  );
END $$;

-- Restrict the callable queue entry point to the order being settled in the
-- current transaction. It cannot enroll historical orders or pick a rate.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.queue_product_binary_pool_order(uuid,timestamptz,integer)'::regprocedure) INTO definition;
  IF position('  INSERT INTO product_binary_pool_weeks' IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected Product Binary queue implementation is missing.';
  END IF;
  EXECUTE replace(definition, '  INSERT INTO product_binary_pool_weeks', $guard$
  IF NOT EXISTS (
    SELECT 1 FROM public.product_binary_order_events e
    WHERE e.id = order_key AND e.processed_at = transaction_timestamp()
  ) OR target_week <> date_trunc('week', clock_timestamp() AT TIME ZONE 'Asia/Manila')::date
     OR rate_centavos <> public.product_binary_pair_amount() * 100 THEN
    RAISE EXCEPTION 'Invalid Product Binary weekly queue source.';
  END IF;
  INSERT INTO product_binary_pool_weeks$guard$);
END $$;
