-- Business policy: from every eligible Admin product sale, earmark at most
-- ₱20 per physical unit for Product Binary. The rest of the realized Admin
-- gross margin is clean company product margin. The allocation can never
-- exceed the gross margin actually realized by that movement.

DROP TRIGGER IF EXISTS inventory_movement_create_product_binary_funding ON inventory_movements;

-- These funding tables are accounting classifications introduced by the
-- immediately preceding migration. Rebuild them deterministically; no wallet,
-- commission, order, or payout record is changed.
DELETE FROM product_binary_funding_consumptions;
DELETE FROM product_binary_funding_lots;

INSERT INTO product_binary_funding_lots(inventory_movement_id,original_amount,remaining_amount,snapshot_source,allocated_at)
SELECT im.id,
  LEAST(im.admin_profit, im.quantity * 20.00),
  LEAST(im.admin_profit, im.quantity * 20.00),
  'max_pair_rate_per_product',im.created_at
FROM inventory_movements im JOIN products p ON p.id::text=im.product_id::text
WHERE im.is_sale=true AND im.admin_profit>0 AND p.binary_eligible=true AND im.quantity>0
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION create_product_binary_funding_lot() RETURNS TRIGGER AS $$
DECLARE eligible BOOLEAN; allocation DECIMAL(12,2); BEGIN
 SELECT binary_eligible INTO eligible FROM products WHERE id::text=NEW.product_id::text;
 allocation:=LEAST(NEW.admin_profit,NEW.quantity*20.00);
 IF NEW.is_sale=true AND eligible=true AND allocation>0 THEN
  INSERT INTO product_binary_funding_lots(inventory_movement_id,original_amount,remaining_amount,snapshot_source,allocated_at)
  VALUES(NEW.id,allocation,allocation,'max_pair_rate_per_product',NEW.created_at) ON CONFLICT DO NOTHING;
 END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_movement_create_product_binary_funding AFTER INSERT ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION create_product_binary_funding_lot();

-- Re-apply all normal Product Binary earnings against the corrected pool in
-- chronological order. Legacy wallets remain untouched.
DO $$ DECLARE c RECORD; BEGIN FOR c IN
 SELECT id,amount,created_at FROM commissions WHERE type='sponsor_point' AND is_pair_overflow=false AND amount>0 ORDER BY created_at,id
 LOOP PERFORM consume_product_binary_funding(c.id,c.amount,c.created_at); END LOOP; END $$;
