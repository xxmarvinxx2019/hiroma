ALTER TABLE public.product_binary_pool_weeks ADD COLUMN release_started_at timestamptz;

CREATE INDEX product_binary_pending_release_idx
ON public.product_binary_pool_allocations (week_start, recipient_user_id)
WHERE commission_id IS NULL AND retained_at IS NULL AND amount_centavos > 0;

-- Keep the existing restricted entry point and its grants. Each call commits
-- independently. A negative result means the initial reconciliation held it.
CREATE OR REPLACE FUNCTION public.release_product_binary_pool_week(target_week date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  week_row public.product_binary_pool_weeks;
  member_id text;
  credited integer := 0;
BEGIN
  SELECT * INTO STRICT week_row FROM public.product_binary_pool_weeks
  WHERE week_start = target_week FOR UPDATE;
  IF week_row.released_at IS NOT NULL THEN RETURN 0; END IF;
  IF week_row.closed_at IS NULL OR clock_timestamp() <
     (((target_week + 9) + time '10:00') AT TIME ZONE 'Asia/Manila') THEN
    RAISE EXCEPTION 'Product Binary week is not ready for Wednesday release.';
  END IF;

  IF week_row.release_started_at IS NULL THEN
    IF public.verify_product_binary_week_readiness(target_week) IS NOT NULL THEN
      RETURN -1;
    END IF;
    UPDATE public.product_binary_pool_weeks SET release_started_at = clock_timestamp()
    WHERE week_start = target_week;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));
  FOR member_id IN
    SELECT a.recipient_user_id
    FROM public.product_binary_pool_allocations a
    JOIN public.users u ON u.id = a.recipient_user_id
    JOIN public.wallets wallet ON wallet.user_id = u.id
    WHERE a.week_start = target_week AND a.amount_centavos > 0
      AND a.commission_id IS NULL AND a.retained_at IS NULL
      AND u.role = 'reseller' AND u.status = 'active'
    ORDER BY a.recipient_user_id LIMIT 250 FOR SHARE OF u
  LOOP
    IF NOT public.credit_product_binary_pool_allocation(target_week, member_id) THEN
      RAISE EXCEPTION 'Product Binary allocation could not be credited.';
    END IF;
    credited := credited + 1;
  END LOOP;

  -- A zero-credit pass found no currently eligible recipients. Ineligible
  -- allocations stay reserved for the existing deferred-credit workflow.
  IF credited = 0 THEN
    UPDATE public.product_binary_pool_weeks SET released_at = clock_timestamp()
    WHERE week_start = target_week;
  END IF;
  RETURN credited;
END;
$$;

-- A long-running release may cross the deferred cutoff. Apply the same
-- cutoff to suspended accounts as soon as the initial release has started.
DO $$
DECLARE
  signature regprocedure;
  definition text;
BEGIN
  SELECT pg_get_functiondef('public.verify_product_binary_week_readiness(date)'::regprocedure) INTO definition;
  IF strpos(definition, 'OR w.released_at IS NOT NULL THEN') = 0 THEN
    RAISE EXCEPTION 'Expected Product Binary readiness guard is missing.';
  END IF;
  EXECUTE replace(definition, 'OR w.released_at IS NOT NULL THEN',
    'OR w.released_at IS NOT NULL OR w.release_started_at IS NOT NULL THEN');

  FOREACH signature IN ARRAY ARRAY[
    'public.expire_deferred_product_binary_credits()'::regprocedure,
    'public.retain_expired_product_binary_on_reactivation()'::regprocedure
  ]
  LOOP
    SELECT pg_get_functiondef(signature) INTO definition;
    IF strpos(definition, 'w.released_at IS NOT NULL') = 0 THEN
      RAISE EXCEPTION 'Expected Product Binary deferred cutoff guard is missing.';
    END IF;
    EXECUTE replace(definition, 'w.released_at IS NOT NULL',
      '(w.released_at IS NOT NULL OR w.release_started_at IS NOT NULL)');
  END LOOP;
END $$;
