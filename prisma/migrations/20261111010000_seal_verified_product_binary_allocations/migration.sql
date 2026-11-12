BEGIN;

ALTER TABLE public.product_binary_week_preparation ADD COLUMN verification_completed_at timestamptz;

-- Published allocation amounts stay stable between a completed recipient
-- verification and payout. Crediting and deferred retention still write
-- their own lifecycle fields.
CREATE FUNCTION public.seal_closed_product_binary_allocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  previous_week date;
  next_week date;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.week_start, NEW.recipient_user_id, NEW.payable_pairs, NEW.amount_centavos)
       IS NOT DISTINCT FROM ROW(OLD.week_start, OLD.recipient_user_id, OLD.payable_pairs, OLD.amount_centavos) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP <> 'INSERT' THEN previous_week := OLD.week_start; END IF;
  IF TG_OP <> 'DELETE' THEN next_week := NEW.week_start; END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_binary_pool_weeks w
    WHERE w.closed_at IS NOT NULL AND w.week_start IN (previous_week, next_week)
  ) THEN
    RAISE EXCEPTION 'Closed Product Binary allocations cannot be added, removed or recalculated.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.seal_closed_product_binary_allocation() FROM PUBLIC;
CREATE TRIGGER product_binary_allocations_seal_closed_amount
BEFORE INSERT OR UPDATE OR DELETE ON public.product_binary_pool_allocations
FOR EACH ROW EXECUTE FUNCTION public.seal_closed_product_binary_allocation();

UPDATE public.product_binary_week_preparation p
SET verification_completed_at = w.readiness_checked_at
FROM public.product_binary_pool_weeks w
WHERE w.week_start = p.week_start AND p.stage = 'complete'
  AND w.closed_at IS NOT NULL AND w.readiness_checked_at IS NOT NULL AND w.readiness_blocker IS NULL;

DO $$
DECLARE
  definition text;
  from_pos integer;
  to_pos integer;
BEGIN
  SELECT pg_get_functiondef('public.verify_product_binary_week_readiness(date)'::regprocedure) INTO definition;
  from_pos := strpos(definition, '  IF w.readiness_checked_at IS NOT NULL');
  to_pos := strpos(definition, '  IF preparation.stage <>');
  IF from_pos = 0 OR to_pos <= from_pos THEN RAISE EXCEPTION 'Expected Product Binary verification cache is missing.'; END IF;
  definition := left(definition, from_pos - 1) || substr(definition, to_pos);
  definition := replace(definition, E'  ELSE\n    FOR recipient IN', E'  ELSIF preparation.verification_completed_at IS NULL THEN\n    FOR recipient IN');

  from_pos := strpos(definition, '      ELSE' || chr(10) || '        PERFORM pg_advisory_xact_lock');
  to_pos := strpos(definition, '  UPDATE public.product_binary_week_preparation' || chr(10) || '  SET verification_cursor = NULL');
  IF from_pos = 0 OR to_pos <= from_pos OR strpos(definition, 'ELSIF preparation.verification_completed_at IS NULL') = 0 THEN
    RAISE EXCEPTION 'Expected Product Binary funding verification is missing.';
  END IF;
  definition := left(definition, from_pos - 1) || $verify$
      ELSE
        UPDATE public.product_binary_week_preparation SET verification_completed_at = clock_timestamp()
        WHERE week_start = target_week;
      END IF;
    END IF;
  END IF;
  IF blocker IS NULL THEN
    -- Recheck real funding hourly and immediately before the first release.
    PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));
    SELECT COALESCE(SUM(GREATEST(0, remaining_amount - public.product_binary_inventory_earmark(order_id))), 0)
    INTO available FROM public.product_binary_funding_lots WHERE allocated_at <= CURRENT_TIMESTAMP;
    IF w.allocated_centavos > GREATEST(0, available - public.product_binary_week_funding_held(target_week)) * 100 THEN
      blocker := 'Available funded reserve is insufficient.';
    END IF;
  END IF;
$verify$ || substr(definition, to_pos);
  EXECUTE definition;
END $$;

-- Only the guarded verifier may call its legacy implementation.
DO $$
DECLARE role_name text;
BEGIN
  FOR role_name IN
    SELECT r.rolname
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
    JOIN pg_roles r ON r.oid = acl.grantee
    WHERE p.oid = 'public.verify_legacy_product_binary_week_readiness(date)'::regprocedure
      AND r.oid <> p.proowner AND acl.privilege_type = 'EXECUTE'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.verify_legacy_product_binary_week_readiness(date) FROM %I CASCADE',
      role_name);
  END LOOP;
END $$;

COMMIT;
