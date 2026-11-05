-- A released week can still have outstanding allocations for members who
-- were ineligible at release. Keep their funds earmarked until credited.
CREATE OR REPLACE FUNCTION public.product_binary_week_funding_held(exclude_allocations_for date DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE((SELECT SUM(retained_centavos) FROM public.product_binary_week_funding), 0) / 100
    + COALESCE((SELECT SUM(a.amount_centavos) FROM public.product_binary_pool_allocations a
       JOIN public.product_binary_pool_weeks w USING (week_start)
       WHERE w.closed_at IS NOT NULL AND a.commission_id IS NULL
         AND a.week_start IS DISTINCT FROM exclude_allocations_for), 0) / 100
    + 5 * ((SELECT COALESCE(SUM(units), 0)::numeric FROM public.product_binary_non_member_reserve_releases)
         - (SELECT COALESCE(SUM(units), 0)::numeric FROM public.product_binary_non_member_reserve_restorations)
         + (SELECT COALESCE(SUM(units), 0)::numeric FROM public.product_binary_replacement_reserve_releases)
         + (SELECT COALESCE(SUM(released_units), 0)::numeric FROM public.product_binary_package_reserve_releases))
$$;

DO $$
DECLARE definition text;
DECLARE first_pos integer;
DECLARE last_pos integer;
BEGIN
  SELECT pg_get_functiondef('public.release_product_binary_pool_week(date)'::regprocedure) INTO definition;
  definition := replace(definition, chr(13), '');
  first_pos := strpos(definition, '  IF EXISTS (' || chr(10) || '    SELECT 1 FROM public.product_binary_pool_allocations a');
  last_pos := strpos(definition, '  PERFORM pg_advisory_xact_lock');
  IF first_pos = 0 OR last_pos <= first_pos THEN RAISE EXCEPTION 'Expected weekly release preflight not found.'; END IF;
  definition := left(definition, first_pos - 1) || substr(definition, last_pos);
  first_pos := strpos(definition, '    SELECT recipient_user_id FROM public.product_binary_pool_allocations');
  last_pos := strpos(definition, ' ORDER BY recipient_user_id');
  IF first_pos = 0 OR last_pos <= first_pos THEN RAISE EXCEPTION 'Expected release recipient loop not found.'; END IF;
  definition := left(definition, first_pos - 1) || $recipients$
    SELECT a.recipient_user_id FROM public.product_binary_pool_allocations a
    JOIN public.users u ON u.id = a.recipient_user_id
    JOIN public.wallets wallet ON wallet.user_id = u.id
    WHERE a.week_start = target_week AND a.amount_centavos > 0
      AND u.role = 'reseller' AND u.status = 'active'
    ORDER BY a.recipient_user_id FOR SHARE OF u$recipients$
    || substr(definition, last_pos + length(' ORDER BY recipient_user_id'));
  IF strpos(definition, 'FOR SHARE OF u') = 0 THEN RAISE EXCEPTION 'Expected release recipient loop not found.'; END IF;
  definition := replace(definition, 'SELECT COALESCE(SUM(GREATEST(0, remaining_amount - public.product_binary_inventory_earmark(order_id))), 0) * 100',
    'SELECT GREATEST(0, COALESCE(SUM(GREATEST(0, remaining_amount - public.product_binary_inventory_earmark(order_id))), 0) - public.product_binary_week_funding_held(target_week)) * 100');
  EXECUTE definition;

  SELECT pg_get_functiondef('public.verify_product_binary_week_readiness(date)'::regprocedure) INTO definition;
  definition := replace(definition, chr(13), '');
  first_pos := strpos(definition, '  ELSIF EXISTS (' || chr(10) || '    SELECT 1 FROM public.product_binary_pool_allocations a');
  last_pos := strpos(definition, '  ELSE' || chr(10) || '    PERFORM pg_advisory_xact_lock');
  IF first_pos = 0 OR last_pos <= first_pos THEN RAISE EXCEPTION 'Expected weekly readiness check not found.'; END IF;
  EXECUTE left(definition, first_pos - 1) || substr(definition, last_pos);
END $$;

CREATE FUNCTION public.retry_deferred_product_binary_credit(target_week date, member_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.product_binary_pool_weeks
  WHERE week_start = target_week AND released_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));
  PERFORM 1 FROM public.users u JOIN public.wallets w ON w.user_id = u.id
  WHERE u.id = member_id AND u.role = 'reseller' AND u.status = 'active' FOR SHARE OF u;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN public.credit_product_binary_pool_allocation(target_week, member_id);
END;
$$;
REVOKE ALL ON FUNCTION public.retry_deferred_product_binary_credit(date,text) FROM PUBLIC;

