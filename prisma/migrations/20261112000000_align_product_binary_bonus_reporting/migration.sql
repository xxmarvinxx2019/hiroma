BEGIN;

-- NULL indicates that no expired deactivation window affects this week.
CREATE FUNCTION public.product_binary_surviving_pairs(target_week date, recipient text)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT (
    SELECT COALESCE(SUM(e.payable_pairs), 0)
    FROM public.product_binary_pair_events e
    JOIN public.product_binary_pool_pairs p ON p.pair_event_id = e.id
    WHERE p.week_start = target_week AND e.recipient_user_id = recipient
      AND e.created_at >= h.forfeited_before
  )
  FROM public.product_binary_account_holds h
  WHERE h.user_id = recipient
    AND h.forfeited_before >= (target_week::timestamp AT TIME ZONE 'Asia/Manila')
$$;
REVOKE ALL ON FUNCTION public.product_binary_surviving_pairs(date,text) FROM PUBLIC;

DO $$
DECLARE
  definition text;
  first_line integer;
  next_line integer;
  role_grant record;
BEGIN
  SELECT pg_get_functiondef('public.apply_product_binary_expired_window(date,text)'::regprocedure) INTO definition;
  first_line := strpos(definition, '  SELECT h.forfeited_before INTO cutoff');
  next_line := strpos(definition, '  IF surviving_pairs = allocation.payable_pairs');
  IF first_line = 0 OR next_line <= first_line THEN
    RAISE EXCEPTION 'Expected Product Binary expired-window calculation is missing.';
  END IF;
  definition := left(definition, first_line - 1) || $replacement$
  surviving_pairs := public.product_binary_surviving_pairs(target_week, recipient);
  IF surviving_pairs IS NULL THEN RETURN allocation.amount_centavos; END IF;
$replacement$ || substr(definition, next_line);
  EXECUTE replace(definition, '  cutoff timestamptz;' || chr(10), '');

  FOR role_grant IN
    SELECT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
    JOIN pg_roles r ON r.oid = a.grantee
    WHERE p.oid = 'public.product_binary_weekly_pair_eligible(text)'::regprocedure
      AND r.oid <> p.proowner AND a.privilege_type = 'EXECUTE'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.product_binary_surviving_pairs(date,text) TO %I', role_grant.rolname);
  END LOOP;
END $$;

COMMIT;
