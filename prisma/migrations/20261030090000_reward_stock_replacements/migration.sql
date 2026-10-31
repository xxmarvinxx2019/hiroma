BEGIN;
LOCK TABLE product_reward_claims,product_reward_claim_allocations IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE reward_stock_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_allocation_id UUID NOT NULL UNIQUE REFERENCES product_reward_claim_allocations(id),
  origin_outlet_id TEXT NOT NULL REFERENCES users(id), product_id TEXT NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL CHECK(kind IN ('distributor_replacement','internal_replenishment')),
  classification_source TEXT NOT NULL DEFAULT 'claim',
  holder_id TEXT REFERENCES users(id), current_dispatch_id UUID,
  cycle INTEGER NOT NULL DEFAULT 0 CHECK(cycle>=0), settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK((settled_at IS NULL AND holder_id IS NOT NULL) OR (settled_at IS NOT NULL AND holder_id IS NULL AND current_dispatch_id IS NULL))
);
CREATE INDEX reward_stock_units_holder_idx ON reward_stock_units(holder_id,product_id,kind) WHERE settled_at IS NULL;
CREATE TABLE reward_stock_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),client_request_id UUID NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES users(id),recipient_id TEXT NOT NULL REFERENCES users(id),actor_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),kind TEXT NOT NULL CHECK(kind IN ('distributor_replacement','internal_replenishment')),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100),
  supplier_name TEXT NOT NULL DEFAULT '',recipient_name TEXT NOT NULL DEFAULT '',actor_name TEXT NOT NULL DEFAULT '',product_name TEXT NOT NULL DEFAULT '',
  supplier_role TEXT NOT NULL DEFAULT '',
  unit_cost_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0,stock_before INTEGER NOT NULL DEFAULT 0,stock_after INTEGER NOT NULL DEFAULT 0,
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now(),CHECK(supplier_id<>recipient_id)
);
ALTER TABLE reward_stock_units ADD CONSTRAINT reward_stock_units_dispatch_fkey FOREIGN KEY(current_dispatch_id) REFERENCES reward_stock_dispatches(id);
CREATE TABLE reward_stock_dispatch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),dispatch_id UUID NOT NULL REFERENCES reward_stock_dispatches(id),
  unit_id UUID NOT NULL REFERENCES reward_stock_units(id),cycle INTEGER NOT NULL,
  UNIQUE(unit_id,cycle)
);
CREATE INDEX reward_stock_dispatch_items_dispatch_idx ON reward_stock_dispatch_items(dispatch_id);
CREATE TABLE reward_stock_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),dispatch_id UUID NOT NULL UNIQUE REFERENCES reward_stock_dispatches(id),
  actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL DEFAULT '',
  stock_before INTEGER NOT NULL DEFAULT 0,stock_after INTEGER NOT NULL DEFAULT 0,received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reward_stock_dispatches_supplier_idx ON reward_stock_dispatches(supplier_id,dispatched_at);
CREATE INDEX reward_stock_dispatches_recipient_idx ON reward_stock_dispatches(recipient_id,dispatched_at);

-- One original obligation per physical bottle released, never one new credit per hop.
INSERT INTO reward_stock_units(claim_allocation_id,origin_outlet_id,product_id,kind,holder_id,classification_source)
SELECT a.id,c.owner_id,c.product_id,CASE WHEN dp.dist_level::text='branch' THEN 'internal_replenishment' ELSE 'distributor_replacement' END,
  c.owner_id,'legacy_current_profile'
FROM product_reward_claim_allocations a JOIN product_reward_claims c ON c.id=a.claim_id
JOIN distributor_profiles dp ON dp.user_id=c.owner_id;
DO $$ BEGIN
  IF (SELECT count(*) FROM reward_stock_units)<>(SELECT count(*) FROM product_reward_claim_allocations)
  THEN RAISE EXCEPTION 'Historical reward release ownership requires reconciliation.'; END IF;
END $$;

CREATE FUNCTION can_supply_reward_stock(supplier TEXT,recipient TEXT,replacement_kind TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT supplier<>recipient AND EXISTS(SELECT 1 FROM users s WHERE s.id=supplier AND s.status::text='active' AND (
    s.role::text='admin' OR (replacement_kind='distributor_replacement' AND s.role::text IN ('regional','provincial') AND EXISTS (
      WITH RECURSIVE parents AS (
        SELECT id,user_id,parent_dist_id,ARRAY[id] path FROM distributor_profiles WHERE user_id=recipient AND is_active
        UNION ALL SELECT p.id,p.user_id,p.parent_dist_id,c.path||p.id FROM parents c
        JOIN distributor_profiles p ON p.id=c.parent_dist_id WHERE NOT p.id=ANY(c.path) AND p.is_active
      ) SELECT 1 FROM parents WHERE user_id=supplier AND user_id<>recipient
    ))
  ));
$$;
CREATE FUNCTION reward_stock_actor_allowed(owner_id TEXT,actor_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM users o JOIN users a ON a.id=actor_id
    WHERE o.id=owner_id AND o.status::text='active' AND a.status::text='active'
      AND o.role::text IN ('admin','regional','provincial','city')
      AND (o.id=a.id OR EXISTS(SELECT 1 FROM staff_profiles sp WHERE sp.user_id=a.id AND sp.owner_id=o.id AND sp.is_active
        AND a.role::text='staff' AND sp.permissions::jsonb ? (CASE WHEN o.role::text='admin' THEN 'inventory:manage' ELSE 'inventory' END))));
$$;
CREATE FUNCTION seed_reward_stock_unit() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  INSERT INTO reward_stock_units(claim_allocation_id,origin_outlet_id,product_id,kind,holder_id)
  SELECT NEW.id,c.owner_id,c.product_id,CASE WHEN dp.dist_level::text='branch' THEN 'internal_replenishment' ELSE 'distributor_replacement' END,c.owner_id
    FROM product_reward_claims c JOIN distributor_profiles dp ON dp.user_id=c.owner_id WHERE c.id=NEW.claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reward release has no outlet ownership classification.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reward_claim_allocations_seed_stock AFTER INSERT ON product_reward_claim_allocations
FOR EACH ROW EXECUTE FUNCTION seed_reward_stock_unit();

CREATE FUNCTION validate_reward_stock_dispatch() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE stock RECORD; supplier_role TEXT;
BEGIN
  IF NOT reward_stock_actor_allowed(NEW.supplier_id,NEW.actor_id) OR NOT can_supply_reward_stock(NEW.supplier_id,NEW.recipient_id,NEW.kind)
    THEN RAISE EXCEPTION 'Only Hiroma or an authorized upstream supplier can replace this stock.' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM users WHERE id=NEW.recipient_id AND status::text='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Replacement recipient is unavailable.' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('reward-stock-holder:'||NEW.recipient_id||':'||NEW.product_id));
  SELECT full_name,role::text INTO NEW.supplier_name,supplier_role FROM users WHERE id=NEW.supplier_id;
  NEW.supplier_role:=supplier_role;
  SELECT full_name INTO NEW.recipient_name FROM users WHERE id=NEW.recipient_id;
  SELECT full_name INTO NEW.actor_name FROM users WHERE id=NEW.actor_id;
  SELECT name,CASE supplier_role WHEN 'regional' THEN regional_price WHEN 'provincial' THEN provincial_price ELSE cost_price END
    INTO NEW.product_name,NEW.unit_cost_snapshot FROM products WHERE id=NEW.product_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Replacement product is unavailable.' USING ERRCODE='23514'; END IF;
  SELECT quantity,reserved_quantity INTO stock FROM inventory WHERE owner_id=NEW.supplier_id AND product_id=NEW.product_id FOR UPDATE;
  IF NOT FOUND OR stock.quantity-stock.reserved_quantity<NEW.quantity THEN RAISE EXCEPTION 'Not enough available supplier stock.' USING ERRCODE='23514'; END IF;
  NEW.stock_before:=stock.quantity;NEW.stock_after:=stock.quantity-NEW.quantity;NEW.dispatched_at:=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER reward_stock_dispatches_validate BEFORE INSERT ON reward_stock_dispatches
FOR EACH ROW EXECUTE FUNCTION validate_reward_stock_dispatch();

CREATE FUNCTION fulfill_reward_stock_dispatch() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE unit RECORD; remaining INTEGER:=NEW.quantity;
BEGIN
  FOR unit IN SELECT * FROM reward_stock_units WHERE holder_id=NEW.recipient_id AND product_id=NEW.product_id
      AND kind=NEW.kind AND current_dispatch_id IS NULL AND settled_at IS NULL ORDER BY created_at,id LIMIT NEW.quantity FOR UPDATE
  LOOP
    INSERT INTO reward_stock_dispatch_items(dispatch_id,unit_id,cycle) VALUES(NEW.id,unit.id,unit.cycle);
    UPDATE reward_stock_units SET current_dispatch_id=NEW.id WHERE id=unit.id;
    remaining:=remaining-1;
  END LOOP;
  IF remaining<>0 THEN RAISE EXCEPTION 'Not enough pending replacement bottles.' USING ERRCODE='23514'; END IF;
  UPDATE inventory SET quantity=quantity-NEW.quantity,updated_at=clock_timestamp()
    WHERE owner_id=NEW.supplier_id AND product_id=NEW.product_id AND quantity-reserved_quantity>=NEW.quantity;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not enough available supplier stock.' USING ERRCODE='23514'; END IF;
  INSERT INTO inventory_audit_events(id,owner_id,product_id,actor_id,actor_name_snapshot,event_type,quantity_delta,quantity_before,quantity_after,
    unit_cost_snapshot,total_value,reference_type,reference_id,reason,metadata,created_at)
  VALUES(gen_random_uuid(),NEW.supplier_id,NEW.product_id,NEW.actor_id,NEW.actor_name,'reward_replacement_dispatch',-NEW.quantity,NEW.stock_before,NEW.stock_after,
    NEW.unit_cost_snapshot,NEW.quantity*NEW.unit_cost_snapshot,'reward_stock_dispatch',NEW.id::text,'Reward replacement stock dispatched; awaiting receipt',
    jsonb_build_object('recipient_id',NEW.recipient_id,'kind',NEW.kind),NEW.dispatched_at);
  RETURN NEW;
END $$;
CREATE TRIGGER reward_stock_dispatches_fulfill AFTER INSERT ON reward_stock_dispatches
FOR EACH ROW EXECUTE FUNCTION fulfill_reward_stock_dispatch();

CREATE FUNCTION receive_reward_stock_dispatch() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE shipment reward_stock_dispatches%ROWTYPE; supplier_role TEXT; receiving INTEGER; applied INTEGER;
BEGIN
  SELECT * INTO shipment FROM reward_stock_dispatches WHERE id=NEW.dispatch_id FOR UPDATE;
  IF NOT FOUND OR NOT reward_stock_actor_allowed(shipment.recipient_id,NEW.actor_id) THEN
    RAISE EXCEPTION 'Only the authorized recipient can confirm this delivery.' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM reward_stock_receipts WHERE dispatch_id=NEW.dispatch_id) THEN
    RAISE EXCEPTION 'This replacement delivery was already received.' USING ERRCODE='23514'; END IF;
  supplier_role:=shipment.supplier_role;
  -- No new obligation is minted. Move the original unit to the supplying distributor,
  -- or close it when Hiroma supplied the replacement (including company branches).
  UPDATE reward_stock_units SET holder_id=CASE WHEN supplier_role='admin' THEN NULL ELSE shipment.supplier_id END,
      current_dispatch_id=NULL,settled_at=CASE WHEN supplier_role='admin' THEN clock_timestamp() ELSE NULL END,cycle=cycle+1
    WHERE current_dispatch_id=shipment.id AND holder_id=shipment.recipient_id AND settled_at IS NULL;
  GET DIAGNOSTICS applied=ROW_COUNT;
  IF applied<>shipment.quantity THEN RAISE EXCEPTION 'Replacement obligation allocation mismatch.' USING ERRCODE='23514'; END IF;
  INSERT INTO inventory(id,owner_id,product_id,quantity,reserved_quantity,low_stock_threshold,updated_at)
    VALUES(gen_random_uuid(),shipment.recipient_id,shipment.product_id,shipment.quantity,0,10,clock_timestamp())
    ON CONFLICT(owner_id,product_id) DO UPDATE SET quantity=inventory.quantity+shipment.quantity,updated_at=clock_timestamp()
    RETURNING quantity INTO receiving;
  SELECT full_name INTO NEW.actor_name FROM users WHERE id=NEW.actor_id;
  NEW.stock_before:=receiving-shipment.quantity;NEW.stock_after:=receiving;NEW.received_at:=clock_timestamp();
  INSERT INTO inventory_audit_events(id,owner_id,product_id,actor_id,actor_name_snapshot,event_type,quantity_delta,quantity_before,quantity_after,
    unit_cost_snapshot,total_value,reference_type,reference_id,reason,metadata,created_at)
  VALUES(gen_random_uuid(),shipment.recipient_id,shipment.product_id,NEW.actor_id,NEW.actor_name,'reward_replacement_received',shipment.quantity,NEW.stock_before,NEW.stock_after,
    shipment.unit_cost_snapshot,shipment.quantity*shipment.unit_cost_snapshot,'reward_stock_dispatch',shipment.id::text,
    'Reward replacement stock physically received',jsonb_build_object('supplier_id',shipment.supplier_id,'kind',shipment.kind),NEW.received_at);
  RETURN NEW;
END $$;
CREATE TRIGGER reward_stock_receipts_receive BEFORE INSERT ON reward_stock_receipts
FOR EACH ROW EXECUTE FUNCTION receive_reward_stock_dispatch();

CREATE FUNCTION protect_reward_stock_unit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth()>1 THEN
    IF TG_OP='INSERT' THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND (to_jsonb(OLD)-ARRAY['holder_id','current_dispatch_id','cycle','settled_at'])=
      (to_jsonb(NEW)-ARRAY['holder_id','current_dispatch_id','cycle','settled_at']) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Replacement obligations can change only through a recorded release or receipt.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER reward_stock_units_protect BEFORE INSERT OR UPDATE OR DELETE ON reward_stock_units
FOR EACH ROW EXECUTE FUNCTION protect_reward_stock_unit();
CREATE FUNCTION protect_reward_stock_dispatch_item() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' AND pg_trigger_depth()>1 AND EXISTS(
    SELECT 1 FROM reward_stock_units u JOIN reward_stock_dispatches d ON d.id=NEW.dispatch_id
    WHERE u.id=NEW.unit_id AND u.holder_id=d.recipient_id AND u.product_id=d.product_id AND u.kind=d.kind AND u.cycle=NEW.cycle
      AND u.current_dispatch_id IS NULL AND u.settled_at IS NULL) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Replacement shipment allocations are protected.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER reward_stock_dispatch_items_protect BEFORE INSERT OR UPDATE OR DELETE ON reward_stock_dispatch_items
FOR EACH ROW EXECUTE FUNCTION protect_reward_stock_dispatch_item();
CREATE TRIGGER reward_stock_dispatches_immutable BEFORE UPDATE OR DELETE ON reward_stock_dispatches FOR EACH ROW EXECUTE FUNCTION reject_financial_history_change();
CREATE TRIGGER reward_stock_receipts_immutable BEFORE UPDATE OR DELETE ON reward_stock_receipts FOR EACH ROW EXECUTE FUNCTION reject_financial_history_change();
CREATE TRIGGER reward_stock_units_no_truncate BEFORE TRUNCATE ON reward_stock_units FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();
CREATE TRIGGER reward_stock_dispatches_no_truncate BEFORE TRUNCATE ON reward_stock_dispatches FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();
CREATE TRIGGER reward_stock_receipts_no_truncate BEFORE TRUNCATE ON reward_stock_receipts FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();
CREATE TRIGGER reward_stock_items_no_truncate BEFORE TRUNCATE ON reward_stock_dispatch_items FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();
REVOKE ALL ON FUNCTION seed_reward_stock_unit() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_reward_stock_dispatch() FROM PUBLIC;
REVOKE ALL ON FUNCTION fulfill_reward_stock_dispatch() FROM PUBLIC;
REVOKE ALL ON FUNCTION receive_reward_stock_dispatch() FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_reward_stock_unit() FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_reward_stock_dispatch_item() FROM PUBLIC;
COMMIT;
