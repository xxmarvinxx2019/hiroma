CREATE FUNCTION public.earmark_product_binary_inventory_funding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  city_buyer text;
BEGIN
  IF NEW.reconciliation_status <> 'exact' OR NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT o.buyer_id INTO city_buyer
  FROM public.orders o JOIN public.users u ON u.id = o.buyer_id
  WHERE o.id = NEW.order_id AND u.role = 'city';
  IF city_buyer IS NULL THEN RETURN NEW; END IF;

  IF NEW.remaining_amount < NEW.eligible_units_snapshot::numeric * 5 THEN
    RAISE EXCEPTION 'Qualified City Distributor stock requires PHP 5 Product Binary funding per unit.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));
  INSERT INTO public.product_binary_inventory_reserves
    (source_order_item_id, distributor_id, product_id, funded_units, remaining_units)
  SELECT i.id, city_buyer, i.product_id, i.quantity, i.quantity
  FROM public.order_items i
  WHERE i.order_id = NEW.order_id AND i.binary_eligible_snapshot AND i.pu_value_snapshot > 0;
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_binary_funding_lot_earmark_inventory
AFTER INSERT ON public.product_binary_funding_lots
FOR EACH ROW EXECUTE FUNCTION public.earmark_product_binary_inventory_funding();

REVOKE ALL ON FUNCTION public.earmark_product_binary_inventory_funding() FROM PUBLIC;

CREATE FUNCTION public.product_binary_inventory_earmark(source_order text)
RETURNS numeric LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(SUM(r.remaining_units), 0)::numeric * 5
  FROM public.product_binary_inventory_reserves r
  JOIN public.order_items i ON i.id = r.source_order_item_id
  WHERE i.order_id = source_order
$$;
REVOKE ALL ON FUNCTION public.product_binary_inventory_earmark(text) FROM PUBLIC;

DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.consume_product_binary_funding(text,numeric,timestamp with time zone)'::regprocedure)
  INTO definition;
  IF position('SUM("remaining_amount")' IN definition) = 0
     OR position('SELECT "id", "remaining_amount"' IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected Product Binary funding consumer is missing.';
  END IF;
  definition := replace(definition, 'SUM("remaining_amount")',
    'SUM(GREATEST(0, "remaining_amount" - public.product_binary_inventory_earmark("order_id")))');
  definition := replace(definition, 'SELECT "id", "remaining_amount"',
    'SELECT "id", ("remaining_amount" - public.product_binary_inventory_earmark("order_id")) AS remaining_amount');
  definition := replace(definition, 'WHERE "remaining_amount" > 0',
    'WHERE "remaining_amount" > public.product_binary_inventory_earmark("order_id")');
  EXECUTE definition;
END $$;
