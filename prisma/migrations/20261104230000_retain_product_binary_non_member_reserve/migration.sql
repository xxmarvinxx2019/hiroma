CREATE TABLE public.product_binary_non_member_reserve_releases (
  order_id text NOT NULL REFERENCES public.orders(id),
  source_order_item_id text NOT NULL REFERENCES public.product_binary_inventory_reserves(source_order_item_id),
  units integer NOT NULL CHECK (units > 0),
  released_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id, source_order_item_id)
);
REVOKE ALL ON public.product_binary_non_member_reserve_releases FROM PUBLIC;

CREATE TABLE public.product_binary_non_member_reserve_processed (
  order_id text PRIMARY KEY REFERENCES public.orders(id)
);
REVOKE ALL ON public.product_binary_non_member_reserve_processed FROM PUBLIC;

CREATE FUNCTION public.retain_product_binary_non_member_reserve()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  sale public.orders;
  item record;
  stock record;
  needed integer;
  taken integer;
BEGIN
  SELECT * INTO STRICT sale FROM public.orders WHERE id = NEW.id;
  IF sale.is_non_member_sale IS NOT TRUE OR sale.status <> 'delivered'
     OR sale.payment_status IS DISTINCT FROM 'paid' OR sale.financial_purpose <> 'commerce'
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = sale.seller_id AND role = 'city') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));
  INSERT INTO public.product_binary_non_member_reserve_processed VALUES (sale.id) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  FOR item IN
    SELECT product_id, SUM(quantity)::integer AS quantity
    FROM public.order_items WHERE order_id = sale.id GROUP BY product_id ORDER BY product_id
  LOOP
    needed := item.quantity;
    FOR stock IN
      SELECT source_order_item_id, remaining_units FROM public.product_binary_inventory_reserves
      WHERE distributor_id = sale.seller_id AND product_id = item.product_id AND remaining_units > 0
      ORDER BY created_at, source_order_item_id FOR UPDATE
    LOOP
      taken := LEAST(needed, stock.remaining_units);
      UPDATE public.product_binary_inventory_reserves SET remaining_units = remaining_units - taken
      WHERE source_order_item_id = stock.source_order_item_id;
      INSERT INTO public.product_binary_non_member_reserve_releases (order_id, source_order_item_id, units)
      VALUES (sale.id, stock.source_order_item_id, taken);
      needed := needed - taken;
      EXIT WHEN needed = 0;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.retain_product_binary_non_member_reserve() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER orders_retain_product_binary_non_member_reserve
AFTER INSERT OR UPDATE OF payment_status, status ON public.orders
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.retain_product_binary_non_member_reserve();

CREATE OR REPLACE FUNCTION public.product_binary_week_funding_held(exclude_allocations_for date DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(SUM(f.retained_centavos::numeric +
    CASE WHEN w.released_at IS NULL AND f.week_start IS DISTINCT FROM exclude_allocations_for
      THEN f.allocated_centavos ELSE 0 END), 0) / 100
    + (SELECT COALESCE(SUM(units), 0)::numeric * 5 FROM public.product_binary_non_member_reserve_releases)
  FROM public.product_binary_week_funding f
  JOIN public.product_binary_pool_weeks w USING (week_start)
$$;

