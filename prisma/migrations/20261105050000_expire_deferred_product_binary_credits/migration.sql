ALTER TABLE public.product_binary_pool_allocations
  ADD COLUMN retained_at timestamptz,
  ADD COLUMN retained_reason text,
  ADD CONSTRAINT product_binary_allocation_retained_state CHECK (
    (retained_at IS NULL AND retained_reason IS NULL)
    OR (retained_at IS NOT NULL AND retained_reason IS NOT NULL AND commission_id IS NULL)
  );

CREATE FUNCTION public.expire_deferred_product_binary_credits()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE expired integer;
BEGIN
  UPDATE public.product_binary_pool_allocations a
  SET retained_at = clock_timestamp(), retained_reason = 'Account was ' || u.status::text || ' at the next weekly cutoff.'
  FROM public.product_binary_pool_weeks w, public.users u
  WHERE a.week_start = w.week_start AND a.recipient_user_id = u.id
    AND w.released_at IS NOT NULL AND a.amount_centavos > 0
    AND a.commission_id IS NULL AND a.retained_at IS NULL
    AND u.status IN ('inactive','suspended')
    AND clock_timestamp() >= ((a.week_start + 14)::timestamp AT TIME ZONE 'Asia/Manila');
  GET DIAGNOSTICS expired = ROW_COUNT;
  RETURN expired;
END;
$$;

-- Capture late reactivation even if it happens before the next cron run.
CREATE FUNCTION public.retain_expired_product_binary_on_reactivation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.product_binary_pool_allocations a
  SET retained_at = clock_timestamp(), retained_reason = 'Account was ' || OLD.status::text || ' at the next weekly cutoff.'
  FROM public.product_binary_pool_weeks w
  WHERE a.week_start = w.week_start AND a.recipient_user_id = NEW.id
    AND w.released_at IS NOT NULL AND a.amount_centavos > 0
    AND a.commission_id IS NULL AND a.retained_at IS NULL
    AND clock_timestamp() >= ((a.week_start + 14)::timestamp AT TIME ZONE 'Asia/Manila');
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_retain_expired_product_binary_on_reactivation
AFTER UPDATE OF status ON public.users
FOR EACH ROW WHEN (OLD.status IN ('inactive','suspended') AND NEW.status = 'active')
EXECUTE FUNCTION public.retain_expired_product_binary_on_reactivation();

DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.retry_deferred_product_binary_credit(date,text)'::regprocedure) INTO definition;
  EXECUTE replace(definition, '  RETURN public.credit_product_binary_pool_allocation', $guard$
  IF EXISTS (SELECT 1 FROM public.product_binary_pool_allocations
    WHERE week_start = target_week AND recipient_user_id = member_id AND retained_at IS NOT NULL)
  THEN RETURN false; END IF;
  RETURN public.credit_product_binary_pool_allocation$guard$);
  SELECT pg_get_functiondef('public.product_binary_week_funding_held(date)'::regprocedure) INTO definition;
  EXECUTE replace(definition, 'a.week_start IS DISTINCT FROM exclude_allocations_for',
    '(a.retained_at IS NOT NULL OR a.week_start IS DISTINCT FROM exclude_allocations_for)');
END $$;

REVOKE ALL ON FUNCTION public.expire_deferred_product_binary_credits() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retain_expired_product_binary_on_reactivation() FROM PUBLIC;
