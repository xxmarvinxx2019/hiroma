DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.release_product_binary_pool_week(date)'::regprocedure) INTO definition;
  IF position('  FOR member_id IN' IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected Product Binary release implementation is missing.';
  END IF;
  EXECUTE replace(definition, '  FOR member_id IN', $guard$
  IF EXISTS (
    SELECT 1 FROM public.product_binary_pool_allocations a
    JOIN public.users u ON u.id = a.recipient_user_id
    LEFT JOIN public.wallets w ON w.user_id = u.id
    WHERE a.week_start = target_week AND a.amount_centavos > 0
      AND (u.role <> 'reseller' OR u.status <> 'active' OR w.id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Product Binary release held: one or more recipients are inactive or missing a wallet.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));
  IF allocation_total > (
    SELECT COALESCE(SUM(GREATEST(0, remaining_amount - public.product_binary_inventory_earmark(order_id))), 0) * 100
    FROM public.product_binary_funding_lots
    WHERE allocated_at <= CURRENT_TIMESTAMP AND remaining_amount > 0
  ) THEN
    RAISE EXCEPTION 'Product Binary release held: available funded reserve is insufficient.';
  END IF;

  FOR member_id IN$guard$);
END $$;
