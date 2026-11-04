CREATE TABLE public.product_binary_replacement_reserve_releases (
  dispatch_id uuid NOT NULL REFERENCES public.reward_stock_dispatches(id),
  source_order_item_id text NOT NULL REFERENCES public.product_binary_inventory_reserves(source_order_item_id),
  units integer NOT NULL CHECK (units > 0),
  PRIMARY KEY (dispatch_id, source_order_item_id)
);
REVOKE ALL ON public.product_binary_replacement_reserve_releases FROM PUBLIC;

CREATE TABLE public.product_binary_replacement_reserve_processed (
  dispatch_id uuid PRIMARY KEY REFERENCES public.reward_stock_dispatches(id)
);
REVOKE ALL ON public.product_binary_replacement_reserve_processed FROM PUBLIC;

CREATE FUNCTION public.retain_product_binary_replacement_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  stock record;
  needed integer;
  taken integer;
BEGIN
  IF pg_trigger_depth() < 2 OR NEW.event_type <> 'reward_replacement_dispatch' OR NEW.reference_type <> 'reward_stock_dispatch'
     OR NEW.quantity_delta >= 0 THEN RETURN NEW; END IF;
  SELECT d.quantity INTO needed FROM public.reward_stock_dispatches d
  JOIN public.users u ON u.id = d.supplier_id AND u.role = 'city'
  WHERE d.id::text = NEW.reference_id AND d.supplier_id = NEW.owner_id
    AND d.product_id = NEW.product_id AND d.quantity = -NEW.quantity_delta;
  IF NOT FOUND THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));
  INSERT INTO public.product_binary_replacement_reserve_processed VALUES (NEW.reference_id::uuid)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN NEW; END IF;

  FOR stock IN
    SELECT source_order_item_id, remaining_units FROM public.product_binary_inventory_reserves
    WHERE distributor_id = NEW.owner_id AND product_id = NEW.product_id AND remaining_units > 0
    ORDER BY created_at, source_order_item_id FOR UPDATE
  LOOP
    taken := LEAST(needed, stock.remaining_units);
    UPDATE public.product_binary_inventory_reserves SET remaining_units = remaining_units - taken
    WHERE source_order_item_id = stock.source_order_item_id;
    INSERT INTO public.product_binary_replacement_reserve_releases (dispatch_id, source_order_item_id, units)
    VALUES (NEW.reference_id::uuid, stock.source_order_item_id, taken);
    needed := needed - taken;
    EXIT WHEN needed = 0;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.retain_product_binary_replacement_stock() FROM PUBLIC;
CREATE TRIGGER inventory_audit_retain_product_binary_replacement
AFTER INSERT ON public.inventory_audit_events
FOR EACH ROW EXECUTE FUNCTION public.retain_product_binary_replacement_stock();

CREATE OR REPLACE FUNCTION public.product_binary_week_funding_held(exclude_allocations_for date DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(SUM(f.retained_centavos::numeric +
    CASE WHEN w.released_at IS NULL AND f.week_start IS DISTINCT FROM exclude_allocations_for
      THEN f.allocated_centavos ELSE 0 END), 0) / 100
    + 5 * ((SELECT COALESCE(SUM(units), 0)::numeric FROM public.product_binary_non_member_reserve_releases)
         - (SELECT COALESCE(SUM(units), 0)::numeric FROM public.product_binary_non_member_reserve_restorations)
         + (SELECT COALESCE(SUM(units), 0)::numeric FROM public.product_binary_replacement_reserve_releases))
  FROM public.product_binary_week_funding f
  JOIN public.product_binary_pool_weeks w USING (week_start)
$$;

