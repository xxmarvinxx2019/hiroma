CREATE TABLE public.product_binary_non_member_reserve_restorations (
  adjustment_id uuid NOT NULL REFERENCES public.pos_adjustment_requests(id),
  order_id text NOT NULL,
  source_order_item_id text NOT NULL,
  units integer NOT NULL CHECK (units > 0),
  restored_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (adjustment_id, source_order_item_id),
  FOREIGN KEY (order_id, source_order_item_id)
    REFERENCES public.product_binary_non_member_reserve_releases(order_id, source_order_item_id)
);
REVOKE ALL ON public.product_binary_non_member_reserve_restorations FROM PUBLIC;

CREATE FUNCTION public.restore_product_binary_reserve_on_pos_return()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  sale_order text;
  item record;
  stock record;
  needed integer;
  taken integer;
BEGIN
  IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN RETURN NEW; END IF;
  SELECT order_id INTO sale_order FROM public.pos_transactions
  WHERE id = NEW.pos_transaction_id AND owner_id = NEW.owner_id AND transaction_type = 'non_member_sale';
  IF sale_order IS NULL THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));
  IF EXISTS (SELECT 1 FROM public.product_binary_non_member_reserve_restorations
    WHERE adjustment_id = NEW.id) THEN RETURN NEW; END IF;

  FOR item IN
    SELECT i.product_id, SUM(CASE WHEN NEW.request_type = 'void' THEN i.quantity ELSE a.quantity END)::integer AS units
    FROM public.pos_transaction_items i
    LEFT JOIN public.pos_adjustment_items a ON a.pos_transaction_item_id = i.id AND a.adjustment_request_id = NEW.id
    WHERE i.pos_transaction_id = NEW.pos_transaction_id
      AND (NEW.request_type = 'void' OR a.disposition = 'resellable')
    GROUP BY i.product_id ORDER BY i.product_id
  LOOP
    needed := item.units;
    FOR stock IN
      SELECT r.source_order_item_id, r.units - COALESCE((
        SELECT SUM(s.units) FROM public.product_binary_non_member_reserve_restorations s
        WHERE s.order_id = r.order_id AND s.source_order_item_id = r.source_order_item_id
      ), 0) AS available
      FROM public.product_binary_non_member_reserve_releases r
      JOIN public.product_binary_inventory_reserves l USING (source_order_item_id)
      WHERE r.order_id = sale_order AND l.distributor_id = NEW.owner_id AND l.product_id = item.product_id
      ORDER BY l.created_at, l.source_order_item_id FOR UPDATE OF l
    LOOP
      taken := LEAST(needed, stock.available);
      CONTINUE WHEN taken <= 0;
      UPDATE public.product_binary_inventory_reserves SET remaining_units = remaining_units + taken
      WHERE source_order_item_id = stock.source_order_item_id;
      INSERT INTO public.product_binary_non_member_reserve_restorations
        (adjustment_id, order_id, source_order_item_id, units)
      VALUES (NEW.id, sale_order, stock.source_order_item_id, taken);
      needed := needed - taken;
      EXIT WHEN needed = 0;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.restore_product_binary_reserve_on_pos_return() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER pos_adjustment_restore_product_binary_inventory_reserve
AFTER UPDATE OF status ON public.pos_adjustment_requests
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.restore_product_binary_reserve_on_pos_return();

CREATE OR REPLACE FUNCTION public.product_binary_week_funding_held(exclude_allocations_for date DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(SUM(f.retained_centavos::numeric +
    CASE WHEN w.released_at IS NULL AND f.week_start IS DISTINCT FROM exclude_allocations_for
      THEN f.allocated_centavos ELSE 0 END), 0) / 100
    + 5 * ((SELECT COALESCE(SUM(units), 0)::numeric FROM public.product_binary_non_member_reserve_releases)
         - (SELECT COALESCE(SUM(units), 0)::numeric FROM public.product_binary_non_member_reserve_restorations))
  FROM public.product_binary_week_funding f
  JOIN public.product_binary_pool_weeks w USING (week_start)
$$;
