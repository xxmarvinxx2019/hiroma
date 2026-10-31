BEGIN;
CREATE TABLE product_reward_claim_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), token_hash TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL REFERENCES users(id), actor_id TEXT NOT NULL REFERENCES users(id),
  reseller_id TEXT NOT NULL REFERENCES users(id),
  terminal_id UUID NOT NULL REFERENCES pos_terminals(id), shift_id UUID NOT NULL REFERENCES pos_shifts(id),
  expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE product_reward_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_request_id UUID NOT NULL UNIQUE,
  proof_id UUID NOT NULL UNIQUE REFERENCES product_reward_claim_proofs(id),
  owner_id TEXT NOT NULL REFERENCES users(id), actor_id TEXT NOT NULL REFERENCES users(id),
  reseller_id TEXT NOT NULL REFERENCES users(id), product_id TEXT NOT NULL REFERENCES products(id),
  terminal_id UUID NOT NULL REFERENCES pos_terminals(id), shift_id UUID NOT NULL REFERENCES pos_shifts(id),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  product_name_snapshot TEXT NOT NULL DEFAULT '', outlet_name_snapshot TEXT NOT NULL DEFAULT '',
  actor_name_snapshot TEXT NOT NULL DEFAULT '', unit_cost_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0,
  stock_before INTEGER NOT NULL DEFAULT 0, stock_after INTEGER NOT NULL DEFAULT 0,
  released_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_reward_claims_owner_released_idx ON product_reward_claims(owner_id,released_at);
CREATE INDEX product_reward_claims_member_released_idx ON product_reward_claims(reseller_id,released_at);
CREATE TABLE product_reward_claim_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), claim_id UUID NOT NULL REFERENCES product_reward_claims(id),
  reward_id UUID NOT NULL REFERENCES package_binary_product_rewards(id),
  unit_number INTEGER NOT NULL CHECK(unit_number>0),
  UNIQUE(reward_id,unit_number)
);
CREATE INDEX product_reward_claim_allocations_claim_idx ON product_reward_claim_allocations(claim_id);

CREATE FUNCTION release_product_reward_claim() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  bottle RECORD; proof RECORD; stock RECORD;
  owner_name TEXT; actor_name TEXT; outlet_level TEXT;
BEGIN
  -- Shared by all outlets: a reward can only be allocated once company-wide.
  PERFORM pg_advisory_xact_lock(hashtext('financial-user:' || NEW.reseller_id));
  SELECT * INTO proof FROM product_reward_claim_proofs WHERE id=NEW.proof_id FOR UPDATE;
  IF NOT FOUND OR proof.used_at IS NOT NULL OR proof.expires_at<=clock_timestamp()
    OR (proof.owner_id,proof.actor_id,proof.reseller_id,proof.terminal_id,proof.shift_id)
      IS DISTINCT FROM (NEW.owner_id,NEW.actor_id,NEW.reseller_id,NEW.terminal_id,NEW.shift_id)
  THEN RAISE EXCEPTION 'Scan the reseller Member ID again for this claim.' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(NULLIF(dp.fulfillment_outlet_name,''),u.full_name),dp.dist_level::text
  INTO owner_name,outlet_level FROM users u JOIN distributor_profiles dp ON dp.user_id=u.id
  WHERE u.id=NEW.owner_id AND u.role::text='city' AND u.status::text='active' AND dp.is_active
    AND dp.dist_level::text IN ('city','branch') FOR SHARE OF u,dp;
  IF NOT FOUND THEN RAISE EXCEPTION 'An active branch or city outlet is required.' USING ERRCODE='23514'; END IF;
  SELECT full_name INTO actor_name FROM users WHERE id=NEW.actor_id AND status::text='active' FOR SHARE;
  IF NOT FOUND OR (NEW.actor_id<>NEW.owner_id AND NOT EXISTS (
    SELECT 1 FROM staff_profiles sp JOIN users staff ON staff.id=sp.user_id
    WHERE sp.user_id=NEW.actor_id AND sp.owner_id=NEW.owner_id AND sp.is_active
      AND staff.role::text='staff' AND sp.permissions::jsonb ? 'pos'
  )) THEN RAISE EXCEPTION 'An authorized POS cashier is required.' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM users WHERE id=NEW.reseller_id AND role::text='reseller' AND status::text='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active reseller not found.' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM pos_terminals WHERE id=NEW.terminal_id AND owner_id=NEW.owner_id AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POS terminal is unavailable.' USING ERRCODE='23514'; END IF;
  -- Holding the shift row prevents close-shift from crossing a stock release.
  PERFORM 1 FROM pos_shifts WHERE id=NEW.shift_id AND owner_id=NEW.owner_id
    AND terminal_id=NEW.terminal_id AND opened_by_id=NEW.actor_id AND status::text='open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Open your own cashier shift before releasing rewards.' USING ERRCODE='23514'; END IF;
  SELECT p.name,CASE WHEN outlet_level='branch' THEN p.branch_price ELSE COALESCE(NULLIF(p.city_price,0),p.cost_price) END unit_cost
  INTO bottle FROM products p WHERE p.id=NEW.product_id FOR SHARE;
  IF NOT FOUND OR bottle.unit_cost<0 THEN RAISE EXCEPTION 'Reward product is unavailable.' USING ERRCODE='23514'; END IF;
  NEW.product_name_snapshot:=bottle.name; NEW.outlet_name_snapshot:=owner_name; NEW.actor_name_snapshot:=actor_name;
  NEW.unit_cost_snapshot:=COALESCE(bottle.unit_cost,0); NEW.released_at:=clock_timestamp();
  SELECT quantity,reserved_quantity INTO stock FROM inventory
    WHERE owner_id=NEW.owner_id AND product_id=NEW.product_id FOR UPDATE;
  IF NOT FOUND OR stock.quantity-stock.reserved_quantity<NEW.quantity THEN
    RAISE EXCEPTION 'Not enough available outlet stock.' USING ERRCODE='23514'; END IF;
  NEW.stock_before:=stock.quantity; NEW.stock_after:=stock.quantity-NEW.quantity;
  -- Stock is reserved/decremented only by the AFTER trigger, after the header exists.
  RETURN NEW;
END $$;
CREATE TRIGGER product_reward_claims_validate BEFORE INSERT ON product_reward_claims
FOR EACH ROW EXECUTE FUNCTION release_product_reward_claim();

CREATE FUNCTION fulfill_product_reward_claim() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE credit RECORD; remaining INTEGER:=NEW.quantity; closing INTEGER; receiving_before INTEGER; receiving_after INTEGER;
BEGIN
  FOR credit IN
    SELECT r.id,unit.number FROM package_binary_product_rewards r
    CROSS JOIN LATERAL generate_series(1,r.quantity) unit(number)
    WHERE r.user_id=NEW.reseller_id AND r.product_id=NEW.product_id
      AND NOT EXISTS(SELECT 1 FROM product_reward_claim_allocations a WHERE a.reward_id=r.id AND a.unit_number=unit.number)
    ORDER BY r.created_at,r.id,unit.number LIMIT NEW.quantity
  LOOP
    INSERT INTO product_reward_claim_allocations(claim_id,reward_id,unit_number) VALUES(NEW.id,credit.id,credit.number);
    remaining:=remaining-1;
  END LOOP;
  IF remaining<>0 THEN RAISE EXCEPTION 'Not enough unclaimed reward bottles.' USING ERRCODE='23514'; END IF;
  UPDATE inventory SET quantity=quantity-NEW.quantity,updated_at=clock_timestamp()
    WHERE owner_id=NEW.owner_id AND product_id=NEW.product_id AND quantity-reserved_quantity>=NEW.quantity
    RETURNING quantity INTO closing;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not enough available outlet stock.' USING ERRCODE='23514'; END IF;
  IF closing IS DISTINCT FROM NEW.stock_after THEN RAISE EXCEPTION 'Claim stock snapshot mismatch.' USING ERRCODE='23514'; END IF;
  UPDATE product_reward_claim_proofs SET used_at=NEW.released_at WHERE id=NEW.proof_id;
  INSERT INTO inventory(id,owner_id,product_id,quantity,reserved_quantity,low_stock_threshold,updated_at)
    VALUES(gen_random_uuid(),NEW.reseller_id,NEW.product_id,NEW.quantity,0,10,clock_timestamp())
    ON CONFLICT(owner_id,product_id) DO UPDATE SET quantity=inventory.quantity+NEW.quantity,updated_at=clock_timestamp()
    RETURNING quantity INTO receiving_after;
  receiving_before:=receiving_after-NEW.quantity;
  INSERT INTO inventory_audit_events(id,owner_id,product_id,actor_id,actor_name_snapshot,event_type,
    quantity_delta,quantity_before,quantity_after,unit_cost_snapshot,total_value,reference_type,reference_id,reason,metadata,created_at)
  VALUES
    (gen_random_uuid(),NEW.owner_id,NEW.product_id,NEW.actor_id,NEW.actor_name_snapshot,'product_reward_claim_out',
      -NEW.quantity,closing+NEW.quantity,closing,NEW.unit_cost_snapshot,NEW.quantity*NEW.unit_cost_snapshot,
      'product_reward_claim',NEW.id::text,'Released earned Product Rewards bottle(s)',
      jsonb_build_object('reseller_id',NEW.reseller_id,'shift_id',NEW.shift_id,'terminal_id',NEW.terminal_id),NEW.released_at),
    (gen_random_uuid(),NEW.reseller_id,NEW.product_id,NEW.actor_id,NEW.actor_name_snapshot,'product_reward_claim_in',
      NEW.quantity,receiving_before,receiving_after,0,0,'product_reward_claim',NEW.id::text,
      'Received earned Product Rewards bottle(s)',jsonb_build_object('outlet_id',NEW.owner_id),NEW.released_at);
  RETURN NEW;
END $$;
CREATE TRIGGER product_reward_claims_fulfill AFTER INSERT ON product_reward_claims
FOR EACH ROW EXECUTE FUNCTION fulfill_product_reward_claim();

CREATE FUNCTION protect_product_reward_claim_data() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' AND TG_TABLE_NAME='product_reward_claim_allocations' AND pg_trigger_depth()>1 THEN
    IF EXISTS(SELECT 1 FROM package_binary_product_rewards r JOIN product_reward_claims c ON c.id=NEW.claim_id
      WHERE r.id=NEW.reward_id AND r.user_id=c.reseller_id AND r.product_id=c.product_id AND NEW.unit_number BETWEEN 1 AND r.quantity)
    THEN RETURN NEW; END IF;
  END IF;
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='product_reward_claim_proofs' AND pg_trigger_depth()>1 THEN
    IF OLD.used_at IS NULL AND NEW.used_at IS NOT NULL
      AND (to_jsonb(OLD)-'used_at')=(to_jsonb(NEW)-'used_at') THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Product reward claim history is protected.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER product_reward_claim_allocations_protect BEFORE INSERT OR UPDATE OR DELETE ON product_reward_claim_allocations
FOR EACH ROW EXECUTE FUNCTION protect_product_reward_claim_data();
CREATE TRIGGER product_reward_claims_immutable BEFORE UPDATE OR DELETE ON product_reward_claims
FOR EACH ROW EXECUTE FUNCTION reject_financial_history_change();
CREATE TRIGGER product_reward_claim_proofs_protect BEFORE UPDATE OR DELETE ON product_reward_claim_proofs
FOR EACH ROW EXECUTE FUNCTION protect_product_reward_claim_data();
CREATE TRIGGER product_reward_claims_no_truncate BEFORE TRUNCATE ON product_reward_claims
FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();
CREATE TRIGGER product_reward_claim_allocations_no_truncate BEFORE TRUNCATE ON product_reward_claim_allocations
FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();
CREATE TRIGGER product_reward_claim_proofs_no_truncate BEFORE TRUNCATE ON product_reward_claim_proofs
FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();
REVOKE ALL ON FUNCTION release_product_reward_claim() FROM PUBLIC;
REVOKE ALL ON FUNCTION fulfill_product_reward_claim() FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_product_reward_claim_data() FROM PUBLIC;
COMMIT;
