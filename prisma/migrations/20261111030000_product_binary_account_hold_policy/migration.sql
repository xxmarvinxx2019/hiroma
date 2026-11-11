BEGIN;

CREATE TABLE public.product_binary_account_holds (
  user_id text PRIMARY KEY REFERENCES public.users(id),
  inactive_since timestamptz,
  forfeited_before timestamptz
);
REVOKE ALL ON public.product_binary_account_holds FROM PUBLIC;

INSERT INTO public.product_binary_account_holds(user_id, inactive_since)
SELECT u.id, COALESCE(last_event.created_at, transaction_timestamp())
FROM public.users u
LEFT JOIN LATERAL (
  SELECT e.created_at FROM public.reseller_deactivation_events e
  WHERE e.reseller_id = u.id ORDER BY e.created_at DESC LIMIT 1
) last_event ON true
WHERE u.role = 'reseller' AND u.status = 'inactive';

CREATE FUNCTION public.track_product_binary_account_hold()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.status = 'suspended' THEN
    RAISE EXCEPTION 'Suspended reseller accounts are permanently disabled.' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'inactive' THEN
    INSERT INTO public.product_binary_account_holds(user_id, inactive_since)
    VALUES (OLD.id, clock_timestamp())
    ON CONFLICT (user_id) DO UPDATE SET inactive_since = EXCLUDED.inactive_since;
  ELSIF NEW.status = 'active' AND OLD.status = 'inactive' THEN
    UPDATE public.product_binary_account_holds
    SET forfeited_before = CASE
      WHEN clock_timestamp() >= inactive_since + interval '72 hours'
      THEN GREATEST(forfeited_before, inactive_since + interval '72 hours')
      ELSE forfeited_before END,
      inactive_since = NULL
    WHERE user_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.track_product_binary_account_hold() FROM PUBLIC;
CREATE TRIGGER users_track_product_binary_account_hold
BEFORE UPDATE OF status ON public.users
FOR EACH ROW WHEN (OLD.role = 'reseller' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.track_product_binary_account_hold();

CREATE FUNCTION public.product_binary_weekly_pair_eligible(recipient text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE((
    SELECT u.status = 'active' OR (
      u.status = 'inactive' AND transaction_timestamp() < h.inactive_since + interval '72 hours'
    )
    FROM public.users u LEFT JOIN public.product_binary_account_holds h ON h.user_id = u.id
    WHERE u.id = recipient AND u.role = 'reseller'
  ), false)
$$;
REVOKE ALL ON FUNCTION public.product_binary_weekly_pair_eligible(text) FROM PUBLIC;

DROP TRIGGER users_retain_expired_product_binary_on_reactivation ON public.users;
DROP FUNCTION public.retain_expired_product_binary_on_reactivation();

CREATE OR REPLACE FUNCTION public.expire_deferred_product_binary_credits()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE expired integer;
BEGIN
  WITH expired_accounts AS (
    SELECT u.id, u.status
    FROM public.users u LEFT JOIN public.product_binary_account_holds h ON h.user_id = u.id
    WHERE (u.status = 'suspended' OR (
      u.status = 'inactive' AND clock_timestamp() >= h.inactive_since + interval '72 hours'
    )) AND EXISTS (
      SELECT 1 FROM public.product_binary_pool_allocations pending
      WHERE pending.recipient_user_id = u.id AND pending.amount_centavos > 0
        AND pending.commission_id IS NULL AND pending.retained_at IS NULL
    )
    FOR SHARE OF u
  )
  UPDATE public.product_binary_pool_allocations a
  SET retained_at = clock_timestamp(), retained_reason = CASE WHEN u.status = 'suspended'
    THEN 'Account permanently suspended.' ELSE '72-hour deactivation window expired.' END
  FROM expired_accounts u
  WHERE a.recipient_user_id = u.id AND a.amount_centavos > 0
    AND a.commission_id IS NULL AND a.retained_at IS NULL;
  GET DIAGNOSTICS expired = ROW_COUNT;
  RETURN expired;
END;
$$;

CREATE INDEX product_binary_pending_recipient_idx
ON public.product_binary_pool_allocations(recipient_user_id)
WHERE commission_id IS NULL AND retained_at IS NULL AND amount_centavos > 0;

ALTER TABLE public.product_binary_pool_allocations
  ADD COLUMN partial_retained_centavos bigint NOT NULL DEFAULT 0
  CHECK (partial_retained_centavos >= 0 AND partial_retained_centavos < GREATEST(amount_centavos, 1));

-- Allocations can contain pairs on both sides of a late reactivation. Apply
-- the original weekly rate to the surviving pairs, then retain the difference.
CREATE FUNCTION public.apply_product_binary_expired_window(target_week date, recipient text)
RETURNS bigint LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  allocation public.product_binary_pool_allocations;
  cutoff timestamptz;
  surviving_pairs numeric;
  payable numeric;
BEGIN
  SELECT * INTO STRICT allocation FROM public.product_binary_pool_allocations a
  WHERE a.week_start = target_week AND a.recipient_user_id = recipient;
  IF allocation.retained_at IS NOT NULL THEN RETURN 0; END IF;
  SELECT h.forfeited_before INTO cutoff FROM public.product_binary_account_holds h WHERE h.user_id = recipient;
  IF cutoff IS NULL OR cutoff < (target_week::timestamp AT TIME ZONE 'Asia/Manila') THEN
    RETURN allocation.amount_centavos;
  END IF;

  SELECT COALESCE(SUM(e.payable_pairs), 0) INTO surviving_pairs
  FROM public.product_binary_pair_events e
  JOIN public.product_binary_pool_pairs p ON p.pair_event_id = e.id
  WHERE p.week_start = target_week AND e.recipient_user_id = recipient AND e.created_at >= cutoff;
  IF surviving_pairs = allocation.payable_pairs THEN RETURN allocation.amount_centavos; END IF;

  SELECT div(surviving_pairs * LEAST(w.pool_centavos::numeric, w.total_pairs::numeric * w.max_rate_centavos), w.total_pairs)
  INTO STRICT payable FROM public.product_binary_pool_weeks w WHERE w.week_start = target_week;
  IF payable >= allocation.amount_centavos THEN RETURN allocation.amount_centavos; END IF;
  IF payable = 0 THEN
    UPDATE public.product_binary_pool_allocations a
    SET retained_at = clock_timestamp(), retained_reason = '72-hour deactivation window expired.'
    WHERE a.week_start = target_week AND a.recipient_user_id = recipient;
  ELSE
    UPDATE public.product_binary_pool_allocations a
    SET partial_retained_centavos = allocation.amount_centavos - payable,
      retained_reason = 'Part of this bonus expired after the 72-hour deactivation window.'
    WHERE a.week_start = target_week AND a.recipient_user_id = recipient;
    UPDATE public.product_binary_week_funding f
    SET retained_centavos = f.retained_centavos + allocation.amount_centavos - payable
    WHERE f.week_start = target_week;
  END IF;
  RETURN payable::bigint;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_product_binary_expired_window(date,text) FROM PUBLIC;

-- Full retention still has both lifecycle fields. A partially retained
-- allocation can carry a reason and a credit for the surviving portion.
ALTER TABLE public.product_binary_pool_allocations
  DROP CONSTRAINT product_binary_allocation_retained_state,
  ADD CONSTRAINT product_binary_allocation_retained_state CHECK (
    (retained_at IS NULL AND (retained_reason IS NULL OR partial_retained_centavos > 0)) OR
    (retained_at IS NOT NULL AND retained_reason IS NOT NULL AND commission_id IS NULL AND partial_retained_centavos = 0)
  );

DO $$
DECLARE
  definition text;
  role_grant record;
BEGIN
  SELECT pg_get_functiondef('public.validate_product_binary_pair_event_entitlement()'::regprocedure) INTO definition;
  IF strpos(definition, 'IF NOT weekly_pool AND expected_user_status <> ''active'' THEN') = 0 THEN
    RAISE EXCEPTION 'Expected Product Binary pairing eligibility check is missing.';
  END IF;
  EXECUTE replace(definition, 'IF NOT weekly_pool AND expected_user_status <> ''active'' THEN',
    'IF (weekly_pool AND NOT public.product_binary_weekly_pair_eligible(NEW.recipient_user_id))
      OR (NOT weekly_pool AND expected_user_status <> ''active'') THEN');

  SELECT pg_get_functiondef('public.credit_product_binary_pool_allocation(date,text)'::regprocedure) INTO definition;
  IF strpos(definition, 'credit_amount := allocation.amount_centavos::numeric / 100;') = 0 THEN
    RAISE EXCEPTION 'Expected Product Binary wallet amount is missing.';
  END IF;
  EXECUTE replace(definition, 'credit_amount := allocation.amount_centavos::numeric / 100;',
    'credit_amount := public.apply_product_binary_expired_window(target_week, member_id)::numeric / 100;
  IF credit_amount = 0 THEN RETURN false; END IF;');

  SELECT pg_get_functiondef('public.validate_exact_commission_entitlement()'::regprocedure) INTO definition;
  IF strpos(definition, 'a.amount_centavos::numeric = NEW.amount * 100') = 0 THEN
    RAISE EXCEPTION 'Expected Product Binary commission entitlement is missing.';
  END IF;
  EXECUTE replace(definition, 'a.amount_centavos::numeric = NEW.amount * 100',
    '(a.amount_centavos - a.partial_retained_centavos)::numeric = NEW.amount * 100');

  SELECT pg_get_functiondef('public.release_product_binary_pool_week(date)'::regprocedure) INTO definition;
  IF strpos(definition, '    IF NOT public.credit_product_binary_pool_allocation(target_week, member_id) THEN') = 0
     OR strpos(definition, 'IF credited = 0 THEN') = 0 THEN
    RAISE EXCEPTION 'Expected Product Binary release batch is missing.';
  END IF;
  definition := replace(definition, '  credited integer := 0;', '  credited integer := 0;' || chr(10) || '  processed integer := 0;');
  definition := replace(definition, $old$
    IF NOT public.credit_product_binary_pool_allocation(target_week, member_id) THEN
      RAISE EXCEPTION 'Product Binary allocation could not be credited.';
    END IF;
    credited := credited + 1;$old$, $new$
    processed := processed + 1;
    IF public.credit_product_binary_pool_allocation(target_week, member_id) THEN
      credited := credited + 1;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.product_binary_pool_allocations a
      WHERE a.week_start = target_week AND a.recipient_user_id = member_id AND a.retained_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Product Binary allocation could not be credited or retained.';
    END IF;$new$);
  IF strpos(definition, 'processed := processed + 1;') = 0 THEN
    RAISE EXCEPTION 'Expected Product Binary release credit loop is missing.';
  END IF;
  EXECUTE replace(definition, 'IF credited = 0 THEN', 'IF processed = 0 THEN');

  FOR role_grant IN
    SELECT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
    JOIN pg_roles r ON r.oid = a.grantee
    WHERE p.oid = 'public.queue_product_binary_pool_order(uuid,timestamptz,integer)'::regprocedure
      AND r.oid <> p.proowner AND a.privilege_type = 'EXECUTE'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.product_binary_weekly_pair_eligible(text) TO %I', role_grant.rolname);
  END LOOP;
END $$;

COMMIT;
