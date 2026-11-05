ALTER TABLE public.product_binary_pool_orders
  ADD COLUMN funded_units integer CHECK (funded_units >= 0);

CREATE TABLE public.product_binary_inventory_reserve_transfers (
  order_event_id uuid NOT NULL REFERENCES public.product_binary_pool_orders(order_event_id),
  source_order_item_id text NOT NULL REFERENCES public.product_binary_inventory_reserves(source_order_item_id),
  units integer NOT NULL CHECK (units > 0),
  PRIMARY KEY (order_event_id, source_order_item_id)
);
REVOKE ALL ON public.product_binary_inventory_reserve_transfers FROM PUBLIC;

CREATE FUNCTION public.allocate_product_binary_pool_order_funding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  sale record;
  item record;
  stock record;
  units_needed integer;
  units_taken integer;
  funded integer := 0;
BEGIN
  SELECT e.order_id, e.eligible_units, o.seller_id, u.role INTO STRICT sale
  FROM public.product_binary_order_events e JOIN public.orders o ON o.id = e.order_id
  JOIN public.users u ON u.id = o.seller_id WHERE e.id = NEW.order_event_id;

  PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));
  IF sale.role = 'admin' THEN
    SELECT COALESCE(MAX(LEAST(sale.eligible_units, floor(remaining_amount / 5)::integer)), 0)
    INTO funded FROM public.product_binary_funding_lots
    WHERE order_id = sale.order_id AND reconciliation_status = 'exact';
  ELSIF sale.role = 'city' THEN
    FOR item IN
      SELECT product_id, SUM(quantity)::integer AS quantity
      FROM public.order_items WHERE order_id = sale.order_id
        AND binary_eligible_snapshot AND pu_value_snapshot > 0
      GROUP BY product_id ORDER BY product_id
    LOOP
      units_needed := item.quantity;
      FOR stock IN
        SELECT source_order_item_id, remaining_units FROM public.product_binary_inventory_reserves
        WHERE distributor_id = sale.seller_id AND product_id = item.product_id AND remaining_units > 0
        ORDER BY created_at, source_order_item_id FOR UPDATE
      LOOP
        units_taken := LEAST(units_needed, stock.remaining_units);
        UPDATE public.product_binary_inventory_reserves SET remaining_units = remaining_units - units_taken
        WHERE source_order_item_id = stock.source_order_item_id;
        INSERT INTO public.product_binary_inventory_reserve_transfers VALUES
          (NEW.order_event_id, stock.source_order_item_id, units_taken);
        funded := funded + units_taken;
        units_needed := units_needed - units_taken;
        EXIT WHEN units_needed = 0;
      END LOOP;
    END LOOP;
  END IF;
  NEW.funded_units := funded;
  RETURN NEW;
END;
$$;

ALTER TABLE public.product_binary_inventory_reserve_transfers
  ALTER CONSTRAINT product_binary_inventory_reserve_transfers_order_event_id_fkey
  DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER product_binary_pool_order_allocate_funding
BEFORE INSERT ON public.product_binary_pool_orders
FOR EACH ROW EXECUTE FUNCTION public.allocate_product_binary_pool_order_funding();

REVOKE ALL ON FUNCTION public.allocate_product_binary_pool_order_funding() FROM PUBLIC;

DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.close_product_binary_pool_week(date)'::regprocedure) INTO definition;
  IF position('SUM(e.eligible_units::bigint)' IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected Product Binary weekly close implementation is missing.';
  END IF;
  EXECUTE replace(definition, 'SUM(e.eligible_units::bigint)',
    'SUM(COALESCE(o.funded_units, e.eligible_units)::bigint)');
END $$;
