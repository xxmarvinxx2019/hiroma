ALTER TABLE public.product_binary_pool_weeks ADD COLUMN released_at timestamptz;

-- A release may consume the same lot several times in one transaction.
-- Reconcile the final locked row rather than each deferred trigger snapshot.
CREATE OR REPLACE FUNCTION public.validate_product_binary_funding_lot_balance()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  lot public.product_binary_funding_lots;
  consumed numeric;
BEGIN
  SELECT * INTO STRICT lot FROM public.product_binary_funding_lots WHERE id = NEW.id;
  IF lot.reconciliation_status = 'exact' THEN
    SELECT COALESCE(SUM(amount), 0) INTO consumed
    FROM public.product_binary_funding_consumptions WHERE funding_lot_id = lot.id AND NOT is_unfunded;
    IF lot.remaining_amount IS DISTINCT FROM lot.original_amount - consumed THEN
      RAISE EXCEPTION 'Product Binary funding-lot balance does not reconcile to append-only consumption.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.release_product_binary_pool_week(target_week date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  week_row public.product_binary_pool_weeks;
  member_id text;
  credited integer := 0;
  allocation_total numeric;
BEGIN
  SELECT * INTO STRICT week_row FROM public.product_binary_pool_weeks
  WHERE week_start = target_week FOR UPDATE;
  IF week_row.released_at IS NOT NULL THEN RETURN 0; END IF;
  IF week_row.closed_at IS NULL OR clock_timestamp() <
     (((target_week + 9) + time '10:00') AT TIME ZONE 'Asia/Manila') THEN
    RAISE EXCEPTION 'Product Binary week is not ready for Wednesday release.';
  END IF;

  SELECT COALESCE(SUM(amount_centavos), 0) INTO allocation_total
  FROM public.product_binary_pool_allocations WHERE week_start = target_week;
  IF allocation_total <> week_row.allocated_centavos OR allocation_total > week_row.pool_centavos
     OR EXISTS (SELECT 1 FROM public.product_binary_pool_allocations
                WHERE week_start = target_week AND commission_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Product Binary release requires a reconciled, unreleased week.';
  END IF;

  FOR member_id IN
    SELECT recipient_user_id FROM public.product_binary_pool_allocations
    WHERE week_start = target_week AND amount_centavos > 0 ORDER BY recipient_user_id
  LOOP
    IF NOT public.credit_product_binary_pool_allocation(target_week, member_id) THEN
      RAISE EXCEPTION 'Product Binary allocation could not be credited.';
    END IF;
    credited := credited + 1;
  END LOOP;
  UPDATE public.product_binary_pool_weeks SET released_at = clock_timestamp()
  WHERE week_start = target_week;
  RETURN credited;
END;
$$;

REVOKE ALL ON FUNCTION public.release_product_binary_pool_week(date) FROM PUBLIC;
