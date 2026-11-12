-- Only the event for the final balance needs to reconcile the lot. Deferred
-- events for earlier debits see that same final balance and can skip the sum.
CREATE OR REPLACE FUNCTION public.validate_product_binary_funding_lot_balance()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  lot public.product_binary_funding_lots;
  consumed numeric;
BEGIN
  SELECT * INTO STRICT lot FROM public.product_binary_funding_lots WHERE id = NEW.id;
  IF lot.reconciliation_status <> 'exact'
     OR NEW.remaining_amount IS DISTINCT FROM lot.remaining_amount THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO consumed
  FROM public.product_binary_funding_consumptions WHERE funding_lot_id = lot.id AND NOT is_unfunded;
  IF lot.remaining_amount IS DISTINCT FROM lot.original_amount - consumed THEN
    RAISE EXCEPTION 'Product Binary funding-lot balance does not reconcile to append-only consumption.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE INDEX product_binary_allocations_retained_week_idx
ON public.product_binary_pool_allocations (week_start)
WHERE retained_at IS NOT NULL AND commission_id IS NULL;

-- FIFO uses immutable keys. Indexing the mutable balance forces every debit
-- against the same lot to write new index entries, even during one release.
CREATE INDEX product_binary_funding_fifo_idx
ON public.product_binary_funding_lots (allocated_at, id);
DROP INDEX public.product_binary_funding_remaining_idx;

CREATE OR REPLACE FUNCTION public.product_binary_week_funding_held(exclude_allocations_for date DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE((SELECT SUM(retained_centavos) FROM public.product_binary_week_funding), 0) / 100
    + COALESCE((
      SELECT SUM(held.amount_centavos)
      FROM (
        SELECT a.week_start, a.amount_centavos FROM public.product_binary_pool_allocations a
        WHERE exclude_allocations_for IS NULL AND a.commission_id IS NULL
        UNION ALL
        SELECT a.week_start, a.amount_centavos FROM public.product_binary_pool_allocations a
        WHERE a.week_start < exclude_allocations_for AND a.commission_id IS NULL
        UNION ALL
        SELECT a.week_start, a.amount_centavos FROM public.product_binary_pool_allocations a
        WHERE a.week_start > exclude_allocations_for AND a.commission_id IS NULL
        UNION ALL
        SELECT a.week_start, a.amount_centavos FROM public.product_binary_pool_allocations a
        WHERE a.week_start = exclude_allocations_for AND a.commission_id IS NULL AND a.retained_at IS NOT NULL
      ) held JOIN public.product_binary_pool_weeks w USING (week_start)
      WHERE w.closed_at IS NOT NULL
    ), 0) / 100
    + 5 * (SELECT COALESCE(SUM(remaining_units), 0)::numeric
      FROM public.product_binary_inventory_reserves WHERE source_movement_id IS NOT NULL)
    + 5 * ((SELECT COALESCE(SUM(units), 0)::numeric FROM public.product_binary_non_member_reserve_releases)
         - (SELECT COALESCE(SUM(units), 0)::numeric FROM public.product_binary_non_member_reserve_restorations)
         + (SELECT COALESCE(SUM(units), 0)::numeric FROM public.product_binary_replacement_reserve_releases)
         + (SELECT COALESCE(SUM(released_units), 0)::numeric FROM public.product_binary_package_reserve_releases))
$$;
