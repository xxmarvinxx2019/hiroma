-- Inventory-side earmarks are separate from the weekly bonus pool.
-- Populate only through a verified stock receipt and release through a
-- verified resale. Historic stock needs reconciliation before enrollment.
CREATE TABLE public.product_binary_inventory_reserves (
  source_order_item_id text PRIMARY KEY REFERENCES public.order_items(id),
  distributor_id text NOT NULL REFERENCES public.users(id),
  product_id text NOT NULL REFERENCES public.products(id),
  funded_units integer NOT NULL CHECK (funded_units > 0),
  remaining_units integer NOT NULL CHECK (remaining_units BETWEEN 0 AND funded_units),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX product_binary_inventory_reserves_distributor_product_idx
  ON public.product_binary_inventory_reserves(distributor_id, product_id, created_at)
  WHERE remaining_units > 0;

REVOKE ALL ON public.product_binary_inventory_reserves FROM PUBLIC;
