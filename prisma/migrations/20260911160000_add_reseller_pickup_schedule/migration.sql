ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "pickup_scheduled_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "pickup_schedule_timezone" VARCHAR(40);

CREATE INDEX IF NOT EXISTS "orders_seller_pickup_schedule_idx"
  ON "orders" ("seller_id", "pickup_scheduled_at")
  WHERE "fulfillment_method" = 'partner_pickup' AND "status" NOT IN ('delivered', 'cancelled');

CREATE OR REPLACE FUNCTION enforce_reseller_pickup_schedule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.pickup_scheduled_at IS DISTINCT FROM OLD.pickup_scheduled_at OR
    NEW.pickup_schedule_timezone IS DISTINCT FROM OLD.pickup_schedule_timezone
  ) THEN
    RAISE EXCEPTION 'PICKUP_SCHEDULE_IS_IMMUTABLE' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT'
     AND NEW.fulfillment_method = 'partner_pickup'
     AND EXISTS (SELECT 1 FROM users WHERE id = NEW.buyer_id AND role::text = 'reseller')
  THEN
    IF NEW.pickup_scheduled_at IS NULL OR NEW.pickup_schedule_timezone <> 'Asia/Manila' THEN
      RAISE EXCEPTION 'RESELLER_PICKUP_SCHEDULE_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF NEW.pickup_scheduled_at < CURRENT_TIMESTAMP + INTERVAL '15 minutes'
       OR NEW.pickup_scheduled_at > CURRENT_TIMESTAMP + INTERVAL '30 days' THEN
      RAISE EXCEPTION 'RESELLER_PICKUP_SCHEDULE_OUT_OF_RANGE' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_enforce_reseller_pickup_schedule ON orders;
CREATE TRIGGER orders_enforce_reseller_pickup_schedule
BEFORE INSERT OR UPDATE OF pickup_scheduled_at, pickup_schedule_timezone ON orders
FOR EACH ROW EXECUTE FUNCTION enforce_reseller_pickup_schedule();
REVOKE ALL ON FUNCTION enforce_reseller_pickup_schedule() FROM PUBLIC;

-- Keep one notification per relevant event: seller on placement, buyer on status or payment confirmation.
CREATE OR REPLACE FUNCTION notify_all_order_parties()
RETURNS TRIGGER AS $$
DECLARE
  notification_title TEXT;
  notification_message TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.seller_id <> NEW.buyer_id THEN
      INSERT INTO notifications (user_id, type, title, message, amount, entity_type, entity_id, action_url)
      VALUES (
        NEW.seller_id, 'order_placed', 'New order received',
        'A new order' || COALESCE(' ' || NEW.order_number, '') ||
        ' worth ₱' || TO_CHAR(NEW.total_amount, 'FM999,999,990.00') ||
        CASE WHEN NEW.pickup_scheduled_at IS NOT NULL
          THEN ' is scheduled for pickup on ' || TO_CHAR(NEW.pickup_scheduled_at AT TIME ZONE 'Asia/Manila', 'Mon DD, YYYY FMHH12:MI AM') || '.'
          ELSE ' was placed.' END,
        NEW.total_amount, 'order', NEW.id, notification_order_route(NEW.seller_id::text)
      );
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.buyer_id = NEW.seller_id THEN RETURN NEW; END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    notification_title := CASE NEW.status::text
      WHEN 'processing' THEN 'Order is processing'
      WHEN 'ready_for_pickup' THEN 'Order ready for pickup'
      WHEN 'delivered' THEN 'Order delivered'
      WHEN 'cancelled' THEN 'Order cancelled'
      ELSE 'Order updated' END;
    notification_message := 'Your order' || COALESCE(' ' || NEW.order_number, '') || ' is now ' || REPLACE(NEW.status::text, '_', ' ') || '.';
    INSERT INTO notifications (user_id, type, title, message, amount, entity_type, entity_id, action_url)
    VALUES (NEW.buyer_id, 'order_' || NEW.status::text, notification_title, notification_message, NEW.total_amount, 'order', NEW.id, notification_order_route(NEW.buyer_id::text));
  ELSIF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    notification_title := CASE WHEN NEW.payment_status = 'paid' THEN 'Order payment confirmed' ELSE 'Order payment updated' END;
    notification_message := 'Payment for your order' || COALESCE(' ' || NEW.order_number, '') || ' is now ' || REPLACE(NEW.payment_status, '_', ' ') || '.';
    INSERT INTO notifications (user_id, type, title, message, amount, entity_type, entity_id, action_url)
    VALUES (NEW.buyer_id, 'order_payment_' || NEW.payment_status, notification_title, notification_message, NEW.total_amount, 'order', NEW.id, notification_order_route(NEW.buyer_id::text));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_update_buyer_notification ON orders;
CREATE TRIGGER orders_update_buyer_notification
AFTER UPDATE OF status, payment_status ON orders
FOR EACH ROW EXECUTE FUNCTION notify_all_order_parties();
