CREATE TABLE public.product_binary_package_reserve_releases (
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  product_id text NOT NULL REFERENCES public.products(id),
  released_units integer NOT NULL DEFAULT 0 CHECK (released_units >= 0),
  PRIMARY KEY (reference_type, reference_id, product_id)
);
REVOKE ALL ON public.product_binary_package_reserve_releases FROM PUBLIC;

CREATE FUNCTION public.retain_product_binary_package_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  stock record;
  needed integer;
  taken integer;
  released integer := 0;
BEGIN
  IF NEW.event_type NOT IN ('registration_package_release', 'upgrade_package_release')
     OR NEW.reference_id IS NULL OR NEW.product_id IS NULL OR NEW.quantity_delta >= 0
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = NEW.owner_id AND role = 'city') THEN
    RETURN NEW;
  END IF;

  IF (
    (NEW.event_type = 'registration_package_release' AND NEW.reference_type = 'registration_pin'
      AND EXISTS (SELECT 1 FROM public.pins p JOIN public.pin_registration_product_snapshots i ON i.pin_id=p.id
        JOIN public.registration_financials f ON f.pin_id=p.id AND f.city_dist_id=NEW.owner_id
        WHERE p.id=NEW.reference_id AND p.city_dist_id=NEW.owner_id AND i.product_id=NEW.product_id AND i.quantity=-NEW.quantity_delta))
    OR (NEW.event_type = 'upgrade_package_release' AND NEW.reference_type = 'upgrade_pin'
      AND EXISTS (SELECT 1 FROM public.pins p JOIN public.pin_upgrade_product_snapshots i ON i.pin_id=p.id
        JOIN public.upgrade_financials f ON f.upgrade_pin_id=p.id AND f.city_dist_id=NEW.owner_id
        WHERE p.id=NEW.reference_id AND p.city_dist_id=NEW.owner_id AND i.product_id=NEW.product_id AND i.quantity=-NEW.quantity_delta))
    OR (NEW.event_type = 'registration_package_release' AND NEW.reference_type = 'pos_registration_intake'
      AND EXISTS (SELECT 1 FROM public.pos_registration_intakes i WHERE i.id::text=NEW.reference_id
        AND i.owner_id=NEW.owner_id AND i.released_at IS NOT NULL))
  ) IS NOT TRUE THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));
  INSERT INTO public.product_binary_package_reserve_releases (reference_type, reference_id, product_id)
  VALUES (NEW.reference_type, NEW.reference_id, NEW.product_id) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN NEW; END IF;

  needed := -NEW.quantity_delta;
  FOR stock IN
    SELECT source_order_item_id, remaining_units FROM public.product_binary_inventory_reserves
    WHERE distributor_id=NEW.owner_id AND product_id=NEW.product_id AND remaining_units>0
    ORDER BY created_at, source_order_item_id FOR UPDATE
  LOOP
    taken := LEAST(needed, stock.remaining_units);
    UPDATE public.product_binary_inventory_reserves SET remaining_units=remaining_units-taken
    WHERE source_order_item_id=stock.source_order_item_id;
    released := released + taken;
    needed := needed - taken;
    EXIT WHEN needed = 0;
  END LOOP;

  UPDATE public.product_binary_package_reserve_releases SET released_units=released
  WHERE reference_type=NEW.reference_type AND reference_id=NEW.reference_id AND product_id=NEW.product_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.retain_product_binary_package_stock() FROM PUBLIC;
CREATE TRIGGER inventory_audit_retain_product_binary_package
AFTER INSERT ON public.inventory_audit_events
FOR EACH ROW EXECUTE FUNCTION public.retain_product_binary_package_stock();

CREATE OR REPLACE FUNCTION public.product_binary_week_funding_held(exclude_allocations_for date DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(SUM(f.retained_centavos::numeric +
    CASE WHEN w.released_at IS NULL AND f.week_start IS DISTINCT FROM exclude_allocations_for
      THEN f.allocated_centavos ELSE 0 END), 0) / 100
    + 5 * ((SELECT COALESCE(SUM(units), 0)::numeric FROM public.product_binary_non_member_reserve_releases)
         - (SELECT COALESCE(SUM(units), 0)::numeric FROM public.product_binary_non_member_reserve_restorations)
         + (SELECT COALESCE(SUM(units), 0)::numeric FROM public.product_binary_replacement_reserve_releases)
         + (SELECT COALESCE(SUM(released_units), 0)::numeric FROM public.product_binary_package_reserve_releases))
  FROM public.product_binary_week_funding f
  JOIN public.product_binary_pool_weeks w USING (week_start)
$$;
