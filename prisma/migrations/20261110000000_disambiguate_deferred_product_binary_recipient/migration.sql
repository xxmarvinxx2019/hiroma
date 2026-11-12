CREATE OR REPLACE FUNCTION public.retry_deferred_product_binary_credit(target_week date, member_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.product_binary_pool_weeks w
  WHERE w.week_start = $1 AND w.released_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));
  PERFORM 1 FROM public.users u JOIN public.wallets w ON w.user_id = u.id
  WHERE u.id = $2 AND u.role = 'reseller' AND u.status = 'active' FOR SHARE OF u;
  IF NOT FOUND THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.product_binary_pool_allocations a
    WHERE a.week_start = $1 AND a.recipient_user_id = $2
      AND a.amount_centavos > 0 AND a.commission_id IS NULL AND a.retained_at IS NULL
  ) THEN RETURN false; END IF;

  RETURN public.credit_product_binary_pool_allocation($1, $2);
END;
$$;
REVOKE ALL ON FUNCTION public.retry_deferred_product_binary_credit(date,text) FROM PUBLIC;
