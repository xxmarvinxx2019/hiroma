-- Product Binary funding is the company-side pool created from realized
-- Admin product gross margin. It must never be confused with member liability.
CREATE TABLE "product_binary_funding_lots" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "inventory_movement_id" UUID UNIQUE,
  "original_amount" DECIMAL(12,2) NOT NULL,
  "remaining_amount" DECIMAL(12,2) NOT NULL,
  "snapshot_source" VARCHAR NOT NULL,
  "allocated_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_binary_funding_nonnegative" CHECK("original_amount">=0 AND "remaining_amount">=0),
  CONSTRAINT "product_binary_funding_movement_fkey" FOREIGN KEY("inventory_movement_id") REFERENCES "inventory_movements"("id") ON DELETE RESTRICT
);
CREATE INDEX "product_binary_funding_remaining_idx" ON "product_binary_funding_lots"("remaining_amount","allocated_at");

CREATE TABLE "product_binary_funding_consumptions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "funding_lot_id" UUID,
  "commission_id" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "is_unfunded" BOOLEAN NOT NULL DEFAULT false,
  "consumed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_binary_funding_consumption_positive" CHECK("amount">0),
  CONSTRAINT "product_binary_funding_lot_fkey" FOREIGN KEY("funding_lot_id") REFERENCES "product_binary_funding_lots"("id") ON DELETE RESTRICT,
  CONSTRAINT "product_binary_funding_commission_fkey" FOREIGN KEY("commission_id") REFERENCES "commissions"("id") ON DELETE RESTRICT
);
CREATE INDEX "product_binary_funding_consumption_commission_idx" ON "product_binary_funding_consumptions"("commission_id");
CREATE INDEX "product_binary_funding_consumption_lot_idx" ON "product_binary_funding_consumptions"("funding_lot_id");

-- Every realized Admin inventory sale margin becomes auditable funding. This
-- does not say all margin has been paid; remaining_amount is still company cash
-- earmarked to cover future rank-based Product Binary earnings.
INSERT INTO product_binary_funding_lots(inventory_movement_id,original_amount,remaining_amount,snapshot_source,allocated_at)
SELECT id,admin_profit,admin_profit,'admin_product_margin',created_at
FROM inventory_movements WHERE is_sale=true AND admin_profit>0 ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION create_product_binary_funding_lot() RETURNS TRIGGER AS $$ BEGIN
 IF NEW.is_sale=true AND NEW.admin_profit>0 THEN
  INSERT INTO product_binary_funding_lots(inventory_movement_id,original_amount,remaining_amount,snapshot_source,allocated_at)
  VALUES(NEW.id,NEW.admin_profit,NEW.admin_profit,'admin_product_margin',NEW.created_at) ON CONFLICT DO NOTHING;
 END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_movement_create_product_binary_funding AFTER INSERT ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION create_product_binary_funding_lot();

CREATE OR REPLACE FUNCTION consume_product_binary_funding(target_commission_id TEXT,target_amount DECIMAL(12,2),at_time TIMESTAMPTZ) RETURNS VOID AS $$
DECLARE remaining DECIMAL(12,2); lot RECORD; used DECIMAL(12,2); BEGIN
 IF target_amount<=0 OR EXISTS(SELECT 1 FROM product_binary_funding_consumptions WHERE commission_id=target_commission_id) THEN RETURN; END IF;
 remaining:=target_amount;
 WHILE remaining>0 LOOP
  SELECT id,remaining_amount INTO lot FROM product_binary_funding_lots
  WHERE remaining_amount>0 AND allocated_at<=at_time ORDER BY allocated_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  EXIT WHEN NOT FOUND; used:=LEAST(remaining,lot.remaining_amount);
  UPDATE product_binary_funding_lots SET remaining_amount=remaining_amount-used WHERE id=lot.id;
  INSERT INTO product_binary_funding_consumptions(funding_lot_id,commission_id,amount,is_unfunded,consumed_at)
  VALUES(lot.id,target_commission_id,used,false,at_time); remaining:=remaining-used;
 END LOOP;
 IF remaining>0 THEN INSERT INTO product_binary_funding_consumptions(funding_lot_id,commission_id,amount,is_unfunded,consumed_at)
  VALUES(NULL,target_commission_id,remaining,true,at_time); END IF;
END; $$ LANGUAGE plpgsql;

-- Consume funding automatically for every normal Product Binary commission.
CREATE OR REPLACE FUNCTION fund_product_binary_commission() RETURNS TRIGGER AS $$ BEGIN
 IF NEW.type='sponsor_point' AND NEW.is_pair_overflow=false AND NEW.amount>0 THEN
  PERFORM consume_product_binary_funding(NEW.id,NEW.amount,NEW.created_at);
 END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER commissions_fund_product_binary AFTER INSERT ON commissions
FOR EACH ROW EXECUTE FUNCTION fund_product_binary_commission();

-- Reconcile preserved legacy credits chronologically without modifying wallets.
DO $$ DECLARE c RECORD; BEGIN FOR c IN
 SELECT id,amount,created_at FROM commissions WHERE type='sponsor_point' AND is_pair_overflow=false AND amount>0 ORDER BY created_at,id
 LOOP PERFORM consume_product_binary_funding(c.id,c.amount,c.created_at); END LOOP; END $$;
