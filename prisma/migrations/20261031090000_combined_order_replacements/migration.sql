BEGIN;
CREATE TABLE order_replacement_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id TEXT NOT NULL REFERENCES orders(id), actor_id TEXT NOT NULL REFERENCES users(id),
 product_id TEXT NOT NULL REFERENCES products(id),kind TEXT NOT NULL CHECK(kind IN ('distributor_replacement','internal_replenishment')),
 quantity INT NOT NULL CHECK(quantity BETWEEN 1 AND 100),state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','cancelled','dispatched')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(order_id,product_id,kind)
);
CREATE TABLE order_replacement_units (
 request_id UUID NOT NULL REFERENCES order_replacement_requests(id),unit_id UUID NOT NULL REFERENCES reward_stock_units(id),PRIMARY KEY(request_id,unit_id)
);
CREATE INDEX order_replacement_units_unit_idx ON order_replacement_units(unit_id);
CREATE FUNCTION reserve_combined_order_replacement() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE purchase orders%ROWTYPE; unit RECORD; remaining INT:=NEW.quantity;
BEGIN
 SELECT * INTO purchase FROM orders WHERE id=NEW.order_id FOR UPDATE;
 IF NOT FOUND OR purchase.status::text<>'pending' OR NOT reward_stock_actor_allowed(purchase.buyer_id,NEW.actor_id)
   OR NOT EXISTS(SELECT 1 FROM users WHERE id=purchase.buyer_id AND role::text IN ('city','provincial','regional'))
 THEN RAISE EXCEPTION 'Only pending purchase orders can include replacements.' USING ERRCODE='23514'; END IF;
 IF NOT can_supply_reward_stock(purchase.seller_id,purchase.buyer_id,NEW.kind)
 THEN RAISE EXCEPTION 'Replacement supplier is not authorized.' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('reward-stock-holder:'||purchase.buyer_id||':'||NEW.product_id));
 FOR unit IN SELECT u.id FROM reward_stock_units u WHERE u.holder_id=purchase.buyer_id AND u.product_id=NEW.product_id AND u.kind=NEW.kind
   AND u.settled_at IS NULL AND u.current_dispatch_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM order_replacement_units a JOIN order_replacement_requests r ON r.id=a.request_id WHERE a.unit_id=u.id AND r.state='pending')
   ORDER BY u.created_at,u.id LIMIT NEW.quantity FOR UPDATE
 LOOP
   INSERT INTO order_replacement_units(request_id,unit_id) VALUES(NEW.id,unit.id); remaining:=remaining-1;
 END LOOP;
 IF remaining<>0 THEN RAISE EXCEPTION 'Replacement credits are unavailable or already reserved.' USING ERRCODE='23514'; END IF;
 UPDATE inventory SET reserved_quantity=reserved_quantity+NEW.quantity,updated_at=clock_timestamp()
   WHERE owner_id=purchase.seller_id AND product_id=NEW.product_id AND quantity-reserved_quantity>=NEW.quantity;
 IF NOT FOUND THEN RAISE EXCEPTION 'Replacement stock is currently unavailable. Reduce the quantity or contact the supplier.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_replacement_reserve AFTER INSERT ON order_replacement_requests FOR EACH ROW EXECUTE FUNCTION reserve_combined_order_replacement();
CREATE FUNCTION protect_combined_order_replacement() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (to_jsonb(OLD)-'state')=(to_jsonb(NEW)-'state')
   AND OLD.state='pending' AND NEW.state IN ('cancelled','dispatched') THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' AND NEW.state='pending' THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Combined replacement history is protected.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER order_replacement_protect BEFORE INSERT OR UPDATE OR DELETE ON order_replacement_requests FOR EACH ROW EXECUTE FUNCTION protect_combined_order_replacement();
CREATE FUNCTION protect_combined_order_unit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND pg_trigger_depth()>1 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Combined replacement allocation is protected.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER order_replacement_units_protect BEFORE INSERT OR UPDATE OR DELETE ON order_replacement_units FOR EACH ROW EXECUTE FUNCTION protect_combined_order_unit();
CREATE OR REPLACE FUNCTION fulfill_reward_stock_dispatch() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE unit RECORD; remaining INTEGER:=NEW.quantity;
BEGIN
  FOR unit IN SELECT * FROM reward_stock_units WHERE holder_id=NEW.recipient_id AND product_id=NEW.product_id
      AND kind=NEW.kind AND current_dispatch_id IS NULL AND settled_at IS NULL AND (
        (EXISTS(SELECT 1 FROM order_replacement_requests r WHERE r.id=NEW.id)
         AND EXISTS(SELECT 1 FROM order_replacement_units a WHERE a.request_id=NEW.id AND a.unit_id=reward_stock_units.id))
        OR (NOT EXISTS(SELECT 1 FROM order_replacement_requests r WHERE r.id=NEW.id)
         AND NOT EXISTS(SELECT 1 FROM order_replacement_units a JOIN order_replacement_requests r ON r.id=a.request_id
           WHERE a.unit_id=reward_stock_units.id AND r.state='pending'))
      ) ORDER BY created_at,id LIMIT NEW.quantity FOR UPDATE
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

CREATE FUNCTION settle_combined_order_replacements() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request RECORD; dispatch_actor TEXT;
BEGIN
 IF EXISTS(SELECT 1 FROM order_replacement_requests WHERE order_id=NEW.id) AND
   (NEW.seller_id IS DISTINCT FROM OLD.seller_id OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id)
 THEN RAISE EXCEPTION 'Combined order participants cannot change.'; END IF;
 IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status::text NOT IN ('delivered','cancelled') THEN RETURN NEW; END IF;
 FOR request IN SELECT * FROM order_replacement_requests WHERE order_id=NEW.id AND state='pending' ORDER BY product_id,kind FOR UPDATE
 LOOP
   PERFORM pg_advisory_xact_lock(hashtext('reward-stock-holder:'||NEW.buyer_id||':'||request.product_id));
   UPDATE inventory SET reserved_quantity=reserved_quantity-request.quantity,updated_at=clock_timestamp()
     WHERE owner_id=NEW.seller_id AND product_id=request.product_id AND reserved_quantity>=request.quantity;
   IF NOT FOUND THEN RAISE EXCEPTION 'Combined replacement reservation is missing.'; END IF;
   IF NEW.status::text='delivered' THEN
     dispatch_actor:=COALESCE(NULLIF(current_setting('hiroma.order_actor',true),''),NEW.seller_id);
     INSERT INTO reward_stock_dispatches(id,client_request_id,supplier_id,recipient_id,actor_id,product_id,kind,quantity)
       VALUES(request.id,request.id,NEW.seller_id,NEW.buyer_id,dispatch_actor,request.product_id,request.kind,request.quantity);
     UPDATE order_replacement_requests SET state='dispatched' WHERE id=request.id;
   ELSE
     UPDATE order_replacement_requests SET state='cancelled' WHERE id=request.id;
   END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER orders_combined_replacements AFTER UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION settle_combined_order_replacements();
CREATE TRIGGER order_replacement_no_truncate BEFORE TRUNCATE ON order_replacement_requests FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();
CREATE TRIGGER order_replacement_units_no_truncate BEFORE TRUNCATE ON order_replacement_units FOR EACH STATEMENT EXECUTE FUNCTION reject_financial_history_change();
REVOKE ALL ON FUNCTION reserve_combined_order_replacement() FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_combined_order_replacement() FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_combined_order_unit() FROM PUBLIC;
REVOKE ALL ON FUNCTION settle_combined_order_replacements() FROM PUBLIC;
COMMIT;
