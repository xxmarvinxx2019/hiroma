-- Keep the existing lot key used by resale and return ledgers. Branch lots
-- use a namespaced movement key so they cannot collide with City order items.
ALTER TABLE public.product_binary_inventory_reserves
  DROP CONSTRAINT product_binary_inventory_reserves_source_order_item_id_fkey,
  ADD COLUMN source_movement_id uuid REFERENCES public.inventory_movements(id),
  ADD COLUMN city_order_item_id text GENERATED ALWAYS AS
    (CASE WHEN source_movement_id IS NULL THEN source_order_item_id END) STORED
    REFERENCES public.order_items(id),
  ADD CONSTRAINT product_binary_branch_lot_key CHECK (
    source_movement_id IS NULL OR source_order_item_id = 'branch:' || source_movement_id::text
  );

CREATE FUNCTION public.earmark_product_binary_branch_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  units_to_fund bigint;
  available numeric;
BEGIN
  IF OLD.status <> 'receiving' OR NEW.status NOT IN ('received_full','received_discrepancy')
     OR NOT EXISTS (
       SELECT 1 FROM public.distributor_profiles p
       WHERE p.user_id = NEW.recipient_id AND p.dist_level::text = 'branch'
     )
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = NEW.admin_id AND role = 'admin') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));
  SELECT COALESCE(SUM(m.accepted_quantity),0) INTO units_to_fund
  FROM public.inventory_movements m JOIN public.products p ON p.id = m.product_id::text
  WHERE m.transfer_id = NEW.id AND m.recipient_id::text = NEW.recipient_id AND m.admin_id::text = NEW.admin_id
    AND NOT m.is_sale AND m.accepted_quantity > 0 AND m.received_at IS NOT NULL
    AND p.binary_eligible AND p.pu_value > 0;
  IF units_to_fund = 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(GREATEST(0, remaining_amount-public.product_binary_inventory_earmark(order_id))),0)
  INTO available FROM public.product_binary_funding_lots
  WHERE allocated_at <= CURRENT_TIMESTAMP AND remaining_amount > 0;
  IF units_to_fund * 5 > available - public.product_binary_week_funding_held() THEN
    RAISE EXCEPTION 'Branch receipt requires PHP 5 of available Product Binary funding per eligible bottle.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.product_binary_inventory_reserves
    (source_order_item_id, source_movement_id, distributor_id, product_id, funded_units, remaining_units)
  SELECT 'branch:' || m.id::text, m.id, NEW.recipient_id, m.product_id::text, m.accepted_quantity, m.accepted_quantity
  FROM public.inventory_movements m JOIN public.products p ON p.id = m.product_id::text
  WHERE m.transfer_id = NEW.id AND m.recipient_id::text = NEW.recipient_id AND m.admin_id::text = NEW.admin_id
    AND NOT m.is_sale AND m.accepted_quantity > 0 AND m.received_at IS NOT NULL
    AND p.binary_eligible AND p.pu_value > 0;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.earmark_product_binary_branch_receipt() FROM PUBLIC;
CREATE TRIGGER inventory_transfers_earmark_product_binary_branch
AFTER UPDATE OF status ON public.inventory_transfers
FOR EACH ROW EXECUTE FUNCTION public.earmark_product_binary_branch_receipt();

-- City earmarks are subtracted at the individual funding lot. Branch
-- earmarks reserve existing company funds at the shared ledger level.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.product_binary_week_funding_held(date)'::regprocedure) INTO definition;
  IF strpos(definition, '    + 5 * (') = 0 THEN RAISE EXCEPTION 'Expected Product Binary funding hold calculation is missing.'; END IF;
  EXECUTE replace(definition, '    + 5 * (', $branch$
    + 5 * (SELECT COALESCE(SUM(remaining_units),0)::numeric
      FROM public.product_binary_inventory_reserves WHERE source_movement_id IS NOT NULL)
    + 5 * ($branch$);
END $$;
