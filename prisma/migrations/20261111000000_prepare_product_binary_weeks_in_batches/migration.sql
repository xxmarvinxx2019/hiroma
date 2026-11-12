BEGIN;

-- Source cursors and recipient totals let Monday/Tuesday preparation resume
-- without retaining locks for the entire network.
CREATE TABLE public.product_binary_week_preparation (
  week_start date PRIMARY KEY REFERENCES public.product_binary_pool_weeks(week_start),
  stage text NOT NULL DEFAULT 'orders' CHECK (stage IN ('orders', 'pairs', 'allocations', 'complete')),
  order_cursor uuid,
  pair_cursor uuid,
  recipient_cursor text,
  pool_centavos bigint NOT NULL DEFAULT 0 CHECK (pool_centavos >= 0),
  total_pairs bigint NOT NULL DEFAULT 0 CHECK (total_pairs >= 0),
  allocated_centavos bigint NOT NULL DEFAULT 0 CHECK (allocated_centavos >= 0),
  verification_cursor text,
  verified_pairs bigint NOT NULL DEFAULT 0,
  verified_centavos bigint NOT NULL DEFAULT 0,
  verified_recipients bigint NOT NULL DEFAULT 0
);
CREATE TABLE public.product_binary_prepared_recipients (
  week_start date NOT NULL REFERENCES public.product_binary_week_preparation(week_start),
  recipient_user_id text NOT NULL REFERENCES public.users(id),
  payable_pairs bigint NOT NULL CHECK (payable_pairs > 0),
  PRIMARY KEY (week_start, recipient_user_id)
);
REVOKE ALL ON public.product_binary_week_preparation, public.product_binary_prepared_recipients FROM PUBLIC;
CREATE INDEX product_binary_pool_orders_scan_idx ON public.product_binary_pool_orders(week_start, order_event_id);
CREATE INDEX product_binary_pool_pairs_scan_idx ON public.product_binary_pool_pairs(week_start, pair_event_id);

CREATE OR REPLACE FUNCTION public.require_open_product_binary_pool_week()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE closed timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Product Binary pool sources are append-only.'; END IF;
  SELECT closed_at INTO STRICT closed FROM public.product_binary_pool_weeks
  WHERE week_start = NEW.week_start FOR UPDATE;
  IF closed IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.product_binary_week_preparation WHERE week_start = NEW.week_start
  ) THEN RAISE EXCEPTION 'Cannot add sources to a frozen Product Binary pool week.'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_product_binary_pool_week(target_week date)
RETURNS public.product_binary_pool_weeks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  w public.product_binary_pool_weeks;
  preparation public.product_binary_week_preparation;
  source record;
  last_id uuid;
  last_recipient text;
  batch_total bigint := 0;
  batch_pairs bigint := 0;
  batch_allocated bigint := 0;
BEGIN
  SELECT * INTO STRICT w FROM public.product_binary_pool_weeks WHERE week_start = target_week FOR UPDATE;
  IF w.closed_at IS NOT NULL THEN RETURN w; END IF;
  IF clock_timestamp() < ((target_week + 7)::timestamp AT TIME ZONE 'Asia/Manila') THEN
    RAISE EXCEPTION 'Product Binary pool week has not reached its Manila cutoff.';
  END IF;
  INSERT INTO public.product_binary_week_preparation(week_start) VALUES(target_week) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT preparation FROM public.product_binary_week_preparation WHERE week_start = target_week;
  IF preparation.stage = 'orders' THEN
    FOR source IN
      SELECT o.order_event_id, COALESCE(o.funded_units, e.eligible_units)::bigint AS units
      FROM public.product_binary_pool_orders o JOIN public.product_binary_order_events e ON e.id = o.order_event_id
      WHERE o.week_start = target_week
        AND o.order_event_id >= COALESCE(preparation.order_cursor, '00000000-0000-0000-0000-000000000000'::uuid)
        AND o.order_event_id IS DISTINCT FROM preparation.order_cursor
      ORDER BY o.order_event_id LIMIT 5000
    LOOP
      batch_total := batch_total + source.units * 500;
      last_id := source.order_event_id;
    END LOOP;
    UPDATE public.product_binary_week_preparation
    SET pool_centavos = pool_centavos + batch_total, order_cursor = COALESCE(last_id, order_cursor),
      stage = CASE WHEN last_id IS NULL THEN 'pairs' ELSE stage END
    WHERE week_start = target_week;
    RETURN w;
  END IF;
  IF preparation.stage = 'pairs' THEN
    FOR source IN
      SELECT e.* FROM public.product_binary_pool_pairs p
      JOIN public.product_binary_pair_events e ON e.id = p.pair_event_id
      WHERE p.week_start = target_week
        AND p.pair_event_id >= COALESCE(preparation.pair_cursor, '00000000-0000-0000-0000-000000000000'::uuid)
        AND p.pair_event_id IS DISTINCT FROM preparation.pair_cursor
      ORDER BY p.pair_event_id LIMIT 5000
    LOOP
      IF source.normal_commission_id IS NOT NULL THEN
        RAISE EXCEPTION 'A Product Binary pair in the pool already has a per-order commission.';
      END IF;
      IF source.payable_pairs > 0 THEN
        INSERT INTO public.product_binary_prepared_recipients(week_start, recipient_user_id, payable_pairs)
        VALUES(target_week, source.recipient_user_id, source.payable_pairs)
        ON CONFLICT (week_start, recipient_user_id) DO UPDATE
        SET payable_pairs = product_binary_prepared_recipients.payable_pairs + EXCLUDED.payable_pairs;
      END IF;
      batch_pairs := batch_pairs + source.payable_pairs;
      last_id := source.id;
    END LOOP;
    UPDATE public.product_binary_week_preparation
    SET total_pairs = total_pairs + batch_pairs, pair_cursor = COALESCE(last_id, pair_cursor),
      stage = CASE WHEN last_id IS NULL THEN 'allocations' ELSE stage END
    WHERE week_start = target_week;
    RETURN w;
  END IF;
  IF preparation.stage = 'allocations' THEN
    FOR source IN
      SELECT recipient_user_id, payable_pairs
      FROM public.product_binary_prepared_recipients
      WHERE week_start = target_week
        AND recipient_user_id >= COALESCE(preparation.recipient_cursor, '')
        AND recipient_user_id IS DISTINCT FROM preparation.recipient_cursor
      ORDER BY recipient_user_id LIMIT 1000
    LOOP
      batch_total := div(source.payable_pairs::numeric *
        LEAST(preparation.pool_centavos::numeric, preparation.total_pairs::numeric * w.max_rate_centavos),
        preparation.total_pairs)::bigint;
      INSERT INTO public.product_binary_pool_allocations(week_start, recipient_user_id, payable_pairs, amount_centavos)
      VALUES(target_week, source.recipient_user_id, source.payable_pairs, batch_total);
      batch_allocated := batch_allocated + batch_total;
      last_recipient := source.recipient_user_id;
    END LOOP;
    UPDATE public.product_binary_week_preparation
    SET allocated_centavos = allocated_centavos + batch_allocated,
      recipient_cursor = COALESCE(last_recipient, recipient_cursor)
    WHERE week_start = target_week;
    IF last_recipient IS NOT NULL THEN RETURN w; END IF;
    -- The funding reservation trigger runs only when the final batch closes.
    UPDATE public.product_binary_pool_weeks
    SET closed_at = clock_timestamp(), total_pairs = preparation.total_pairs,
      pool_centavos = preparation.pool_centavos, allocated_centavos = preparation.allocated_centavos
    WHERE week_start = target_week RETURNING * INTO w;
    UPDATE public.product_binary_week_preparation SET stage = 'complete' WHERE week_start = target_week;
  END IF;
  RETURN w;
END;
$$;

-- Retain the complete legacy verifier for weeks finalized before this
-- migration. Prepared weeks use the frozen source totals and bounded pages.
ALTER FUNCTION public.verify_product_binary_week_readiness(date)
RENAME TO verify_legacy_product_binary_week_readiness;
REVOKE ALL ON FUNCTION public.verify_legacy_product_binary_week_readiness(date) FROM PUBLIC;

CREATE FUNCTION public.verify_product_binary_week_readiness(target_week date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  w public.product_binary_pool_weeks;
  preparation public.product_binary_week_preparation;
  recipient record;
  last_recipient text;
  batch_pairs bigint := 0;
  batch_centavos bigint := 0;
  batch_count bigint := 0;
  allocation_count bigint;
  available numeric;
  blocker text;
BEGIN
  SELECT * INTO STRICT w FROM public.product_binary_pool_weeks WHERE week_start = target_week FOR UPDATE;
  IF w.closed_at IS NULL OR w.released_at IS NOT NULL OR w.release_started_at IS NOT NULL THEN
    RETURN 'Week must be finalized and unreleased.';
  END IF;
  SELECT * INTO preparation FROM public.product_binary_week_preparation WHERE week_start = target_week;
  IF NOT FOUND THEN RETURN public.verify_legacy_product_binary_week_readiness(target_week); END IF;
  IF w.readiness_checked_at IS NOT NULL AND w.readiness_blocker IS NULL
     AND w.readiness_checked_at > clock_timestamp() - interval '1 hour' THEN
    RETURN NULL;
  END IF;
  IF preparation.stage <> 'complete' OR w.pool_centavos <> preparation.pool_centavos
     OR w.total_pairs <> preparation.total_pairs OR w.allocated_centavos <> preparation.allocated_centavos THEN
    blocker := 'Prepared funding, pairs, and finalized totals do not reconcile.';
  ELSE
    FOR recipient IN
      SELECT r.recipient_user_id, r.payable_pairs, a.payable_pairs AS actual_pairs, a.amount_centavos, a.commission_id
      FROM public.product_binary_prepared_recipients r
      LEFT JOIN public.product_binary_pool_allocations a USING (week_start, recipient_user_id)
      WHERE r.week_start = target_week
        AND r.recipient_user_id >= COALESCE(preparation.verification_cursor, '')
        AND r.recipient_user_id IS DISTINCT FROM preparation.verification_cursor
      ORDER BY r.recipient_user_id LIMIT 1000
    LOOP
      IF recipient.payable_pairs IS DISTINCT FROM recipient.actual_pairs
         OR recipient.commission_id IS NOT NULL
         OR recipient.amount_centavos::numeric IS DISTINCT FROM
          div(recipient.payable_pairs::numeric *
            LEAST(w.pool_centavos::numeric, w.total_pairs::numeric * w.max_rate_centavos), w.total_pairs) THEN
        blocker := 'One or more recipient allocations do not match the finalized pair records.';
        EXIT;
      END IF;
      batch_pairs := batch_pairs + recipient.payable_pairs;
      batch_centavos := batch_centavos + recipient.amount_centavos;
      batch_count := batch_count + 1;
      last_recipient := recipient.recipient_user_id;
    END LOOP;
    IF blocker IS NULL AND last_recipient IS NOT NULL THEN
      UPDATE public.product_binary_week_preparation
      SET verification_cursor = last_recipient, verified_pairs = verified_pairs + batch_pairs,
        verified_centavos = verified_centavos + batch_centavos, verified_recipients = verified_recipients + batch_count
      WHERE week_start = target_week;
      UPDATE public.product_binary_pool_weeks
      SET readiness_blocker = 'Verification in progress', readiness_checked_at = clock_timestamp()
      WHERE week_start = target_week;
      RETURN 'Verification in progress';
    END IF;
    IF blocker IS NULL THEN
      SELECT COUNT(*) INTO allocation_count FROM public.product_binary_pool_allocations WHERE week_start = target_week;
      IF allocation_count <> preparation.verified_recipients OR preparation.verified_pairs <> w.total_pairs
         OR preparation.verified_centavos <> w.allocated_centavos THEN
        blocker := 'Recorded allocations do not match the prepared recipient totals.';
      ELSE
        PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));
        SELECT COALESCE(SUM(GREATEST(0, remaining_amount - public.product_binary_inventory_earmark(order_id))), 0)
        INTO available FROM public.product_binary_funding_lots WHERE allocated_at <= CURRENT_TIMESTAMP;
        IF w.allocated_centavos > GREATEST(0, available - public.product_binary_week_funding_held(target_week)) * 100 THEN
          blocker := 'Available funded reserve is insufficient.';
        END IF;
      END IF;
    END IF;
  END IF;
  UPDATE public.product_binary_week_preparation
  SET verification_cursor = NULL, verified_pairs = 0, verified_centavos = 0, verified_recipients = 0
  WHERE week_start = target_week;
  UPDATE public.product_binary_pool_weeks SET readiness_checked_at = clock_timestamp(), readiness_blocker = blocker
  WHERE week_start = target_week;
  RETURN blocker;
END;
$$;
REVOKE ALL ON FUNCTION public.verify_product_binary_week_readiness(date) FROM PUBLIC;

-- Preserve the application's existing execute grants on the new wrapper.
DO $$
DECLARE grant_entry record;
BEGIN
  FOR grant_entry IN
    SELECT r.rolname, acl.is_grantable
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
    JOIN pg_roles r ON r.oid = acl.grantee
    WHERE p.oid = 'public.verify_legacy_product_binary_week_readiness(date)'::regprocedure
      AND r.oid <> p.proowner AND acl.privilege_type = 'EXECUTE'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.verify_product_binary_week_readiness(date) TO %I%s',
      grant_entry.rolname, CASE WHEN grant_entry.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
END $$;

COMMIT;
