CREATE TABLE "product_binary_positions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" TEXT NOT NULL UNIQUE,
  "left_carryover_pu" INTEGER NOT NULL DEFAULT 0, "right_carryover_pu" INTEGER NOT NULL DEFAULT 0,
  "lifetime_pairs" INTEGER NOT NULL DEFAULT 0, "lifetime_payable" INTEGER NOT NULL DEFAULT 0,
  "lifetime_flashout" INTEGER NOT NULL DEFAULT 0, "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_binary_position_nonnegative" CHECK ("left_carryover_pu">=0 AND "right_carryover_pu">=0)
);
CREATE TABLE "product_binary_order_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "order_id" TEXT NOT NULL UNIQUE,
  "buyer_user_id" TEXT NOT NULL, "eligible_units" INTEGER NOT NULL, "total_pu" INTEGER NOT NULL,
  "recorded_gross_margin" DECIMAL(12,2) NOT NULL, "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "product_binary_order_events_processed_idx" ON "product_binary_order_events"("processed_at");
CREATE INDEX "product_binary_order_events_buyer_processed_idx" ON "product_binary_order_events"("buyer_user_id","processed_at");
CREATE TABLE "product_binary_pair_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "order_event_id" UUID NOT NULL,
  "recipient_user_id" TEXT NOT NULL, "source_user_id" TEXT NOT NULL, "source_leg" VARCHAR NOT NULL,
  "source_pu" INTEGER NOT NULL, "opening_left_pu" INTEGER NOT NULL, "opening_right_pu" INTEGER NOT NULL,
  "completed_pairs" INTEGER NOT NULL, "payable_pairs" INTEGER NOT NULL,
  "cap_flashout_pairs" INTEGER NOT NULL, "inactive_flashout_pairs" INTEGER NOT NULL,
  "closing_left_pu" INTEGER NOT NULL, "closing_right_pu" INTEGER NOT NULL,
  "package_id_snapshot" TEXT, "package_name_snapshot" VARCHAR NOT NULL,
  "rank_id_snapshot" TEXT, "rank_name_snapshot" VARCHAR NOT NULL,
  "pair_rate_points" DECIMAL(12,2) NOT NULL, "peso_per_point" DECIMAL(8,4) NOT NULL,
  "pair_rate_amount" DECIMAL(12,2) NOT NULL, "payable_amount" DECIMAL(12,2) NOT NULL,
  "flashout_amount" DECIMAL(12,2) NOT NULL, "cap_enabled" BOOLEAN NOT NULL, "cap_limit" INTEGER,
  "normal_commission_id" TEXT, "flashout_commission_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_binary_pair_order_recipient_key" UNIQUE("order_event_id","recipient_user_id"),
  CONSTRAINT "product_binary_pair_counts" CHECK ("completed_pairs"="payable_pairs"+"cap_flashout_pairs"+"inactive_flashout_pairs"),
  CONSTRAINT "product_binary_pair_nonnegative" CHECK ("completed_pairs">=0 AND "payable_amount">=0 AND "flashout_amount">=0),
  CONSTRAINT "product_binary_pair_order_fkey" FOREIGN KEY("order_event_id") REFERENCES "product_binary_order_events"("id") ON DELETE RESTRICT,
  CONSTRAINT "product_binary_pair_normal_fkey" FOREIGN KEY("normal_commission_id") REFERENCES "commissions"("id") ON DELETE RESTRICT,
  CONSTRAINT "product_binary_pair_flash_fkey" FOREIGN KEY("flashout_commission_id") REFERENCES "commissions"("id") ON DELETE RESTRICT
);
CREATE INDEX "product_binary_pair_created_idx" ON "product_binary_pair_events"("created_at");
CREATE INDEX "product_binary_pair_recipient_created_idx" ON "product_binary_pair_events"("recipient_user_id","created_at");
CREATE INDEX "product_binary_pair_rank_created_idx" ON "product_binary_pair_events"("rank_name_snapshot","created_at");
CREATE TABLE "product_binary_payable_lots" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "commission_id" TEXT NOT NULL UNIQUE, "user_id" TEXT NOT NULL,
  "original_amount" DECIMAL(12,2) NOT NULL, "remaining_amount" DECIMAL(12,2) NOT NULL,
  "allocated_at" TIMESTAMPTZ(6) NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_binary_lot_nonnegative" CHECK("original_amount">=0 AND "remaining_amount">=0),
  CONSTRAINT "product_binary_lot_commission_fkey" FOREIGN KEY("commission_id") REFERENCES "commissions"("id") ON DELETE RESTRICT
);
CREATE INDEX "product_binary_lot_user_remaining_idx" ON "product_binary_payable_lots"("user_id","remaining_amount","allocated_at");
CREATE TABLE "product_binary_payout_consumptions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "payout_id" TEXT NOT NULL, "payable_lot_id" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL, "allocated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_binary_payout_lot_key" UNIQUE("payout_id","payable_lot_id"),
  CONSTRAINT "product_binary_consumption_positive" CHECK("amount">0),
  CONSTRAINT "product_binary_consumption_payout_fkey" FOREIGN KEY("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT,
  CONSTRAINT "product_binary_consumption_lot_fkey" FOREIGN KEY("payable_lot_id") REFERENCES "product_binary_payable_lots"("id") ON DELETE RESTRICT
);
CREATE INDEX "product_binary_consumption_payout_idx" ON "product_binary_payout_consumptions"("payout_id");

-- Existing sponsor_point commissions are preserved as legacy financial history.
-- We create payable lots, but never replay old orders into wallets or carryover.
INSERT INTO "product_binary_payable_lots"("commission_id","user_id","original_amount","remaining_amount","allocated_at")
SELECT c.id,c.user_id,c.amount,c.amount,c.created_at FROM commissions c
WHERE c.type='sponsor_point' AND c.is_pair_overflow=false AND c.amount>0 ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION create_product_binary_payable_lot() RETURNS TRIGGER AS $$ BEGIN
 IF NEW.type='sponsor_point' AND NEW.is_pair_overflow=false AND NEW.amount>0 THEN
  INSERT INTO product_binary_payable_lots(commission_id,user_id,original_amount,remaining_amount,allocated_at)
  VALUES(NEW.id,NEW.user_id,NEW.amount,NEW.amount,NEW.created_at) ON CONFLICT DO NOTHING;
 END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER commissions_create_product_binary_payable AFTER INSERT ON commissions
FOR EACH ROW EXECUTE FUNCTION create_product_binary_payable_lot();

CREATE OR REPLACE FUNCTION allocate_product_binary_payout(target_payout_id TEXT,target_user_id TEXT,payout_amount DECIMAL(12,2),allocation_time TIMESTAMPTZ) RETURNS VOID AS $$
DECLARE used DECIMAL(12,2); remaining DECIMAL(12,2); lot RECORD; consumed DECIMAL(12,2); BEGIN
 SELECT COALESCE(SUM(x.amount),0) INTO used FROM (
  SELECT amount FROM direct_referral_payout_consumptions WHERE payout_id=target_payout_id UNION ALL
  SELECT amount FROM binary_payout_consumptions WHERE payout_id=target_payout_id UNION ALL
  SELECT amount FROM product_binary_payout_consumptions WHERE payout_id=target_payout_id
 ) x;
 remaining:=GREATEST(payout_amount-used,0);
 WHILE remaining>0 LOOP
  SELECT id,remaining_amount INTO lot FROM product_binary_payable_lots
  WHERE user_id=target_user_id AND remaining_amount>0 AND allocated_at<=allocation_time
  ORDER BY allocated_at,id FOR UPDATE SKIP LOCKED LIMIT 1; EXIT WHEN NOT FOUND;
  consumed:=LEAST(remaining,lot.remaining_amount);
  UPDATE product_binary_payable_lots SET remaining_amount=remaining_amount-consumed WHERE id=lot.id;
  INSERT INTO product_binary_payout_consumptions(payout_id,payable_lot_id,amount,allocated_at)
  VALUES(target_payout_id,lot.id,consumed,allocation_time) ON CONFLICT DO NOTHING;
  remaining:=remaining-consumed;
 END LOOP; END; $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION allocate_approved_product_binary_payout() RETURNS TRIGGER AS $$ BEGIN
 IF NEW.status='approved' AND (TG_OP='INSERT' OR OLD.status<>'approved') THEN
  PERFORM allocate_product_binary_payout(NEW.id,NEW.user_id,NEW.amount,COALESCE(NEW.processed_at,CURRENT_TIMESTAMP));
 END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER zzz_payouts_allocate_product_binary AFTER INSERT OR UPDATE OF status ON payouts
FOR EACH ROW EXECUTE FUNCTION allocate_approved_product_binary_payout();
