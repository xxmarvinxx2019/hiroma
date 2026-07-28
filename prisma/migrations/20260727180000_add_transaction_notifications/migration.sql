CREATE TABLE IF NOT EXISTS "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "type" VARCHAR NOT NULL,
  "title" VARCHAR NOT NULL,
  "message" TEXT NOT NULL,
  "amount" DECIMAL(12,2),
  "entity_type" VARCHAR,
  "entity_id" TEXT,
  "action_url" VARCHAR,
  "read_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "notifications_user_id_created_at_idx"
  ON "notifications" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "notifications_user_id_read_at_idx"
  ON "notifications" ("user_id", "read_at");

CREATE OR REPLACE FUNCTION notify_reseller_commission()
RETURNS TRIGGER AS $$
DECLARE
  notification_title TEXT;
  notification_message TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND role = 'reseller') THEN
    RETURN NEW;
  END IF;

  notification_title := CASE NEW.type::text
    WHEN 'direct_referral' THEN 'Direct referral earned'
    WHEN 'binary_pairing' THEN 'Binary pairing earned'
    WHEN 'sponsor_point' THEN 'Product binary earned'
    ELSE 'Commission earned'
  END;
  notification_message := notification_title || ': ₱' ||
    TO_CHAR(NEW.amount, 'FM999,999,990.00') ||
    CASE WHEN COALESCE(NEW.points, 0) > 0
      THEN ' (' || NEW.points || ' points)' ELSE '' END;

  INSERT INTO notifications (
    user_id, type, title, message, amount, entity_type, entity_id, action_url
  ) VALUES (
    NEW.user_id, NEW.type::text, notification_title, notification_message,
    NEW.amount, 'commission', NEW.id, '/dashboard/reseller/wallet'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS commissions_create_notification ON commissions;
CREATE TRIGGER commissions_create_notification
AFTER INSERT ON commissions
FOR EACH ROW EXECUTE FUNCTION notify_reseller_commission();

CREATE OR REPLACE FUNCTION notify_reseller_payout()
RETURNS TRIGGER AS $$
DECLARE
  notification_title TEXT;
  notification_message TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND role = 'reseller') THEN
    RETURN NEW;
  END IF;

  -- The reseller already receives an immediate success response after submitting
  -- a payout request. Notify only when Admin changes its status.
  IF TG_OP = 'INSERT' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  ELSE
    notification_title := CASE NEW.status::text
      WHEN 'approved' THEN 'Payout approved'
      WHEN 'rejected' THEN 'Payout rejected'
      WHEN 'released' THEN 'Payout released'
      ELSE 'Payout updated'
    END;
    notification_message := 'Your payout of ₱' ||
      TO_CHAR(NEW.amount, 'FM999,999,990.00') || ' is now ' ||
      NEW.status::text || '.';
  END IF;

  INSERT INTO notifications (
    user_id, type, title, message, amount, entity_type, entity_id, action_url
  ) VALUES (
    NEW.user_id, 'payout_' || NEW.status::text, notification_title,
    notification_message, NEW.amount, 'payout', NEW.id,
    '/dashboard/reseller/payouts'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payouts_create_notification ON payouts;
DROP TRIGGER IF EXISTS payouts_update_notification ON payouts;
CREATE TRIGGER payouts_update_notification
AFTER UPDATE OF status ON payouts
FOR EACH ROW EXECUTE FUNCTION notify_reseller_payout();

CREATE OR REPLACE FUNCTION notify_reseller_order()
RETURNS TRIGGER AS $$
DECLARE
  notification_title TEXT;
  notification_message TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.seller_id <> NEW.buyer_id THEN
    INSERT INTO notifications (
      user_id, type, title, message, amount, entity_type, entity_id, action_url
    ) VALUES (
      NEW.seller_id, 'new_order', 'New order received',
      'A new order' || COALESCE(' ' || NEW.order_number, '') ||
      ' worth ₱' || TO_CHAR(NEW.total_amount, 'FM999,999,990.00') ||
      ' was received.',
      NEW.total_amount, 'order', NEW.id,
      CASE (SELECT role::text FROM users WHERE id = NEW.seller_id)
        WHEN 'admin' THEN '/dashboard/admin/orders'
        WHEN 'regional' THEN '/dashboard/regional/orders'
        WHEN 'provincial' THEN '/dashboard/provincial/orders'
        WHEN 'city' THEN '/dashboard/city/orders'
        ELSE '/dashboard/reseller/orders'
      END
    );
  END IF;

  -- Creating the order is the reseller's own action. The seller is notified
  -- above, while the reseller is notified only on later status changes.
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.buyer_id AND role = 'reseller') THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  ELSE
    notification_title := CASE NEW.status::text
      WHEN 'processing' THEN 'Order is processing'
      WHEN 'delivered' THEN 'Order delivered'
      WHEN 'cancelled' THEN 'Order cancelled'
      ELSE 'Order updated'
    END;
    notification_message := 'Your order' ||
      COALESCE(' ' || NEW.order_number, '') || ' is now ' ||
      NEW.status::text || '.';
  END IF;

  INSERT INTO notifications (
    user_id, type, title, message, amount, entity_type, entity_id, action_url
  ) VALUES (
    NEW.buyer_id, 'order_' || NEW.status::text, notification_title,
    notification_message, NEW.total_amount, 'order', NEW.id,
    '/dashboard/reseller/orders'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_create_buyer_notification ON orders;
CREATE TRIGGER orders_create_buyer_notification
AFTER INSERT ON orders
FOR EACH ROW EXECUTE FUNCTION notify_reseller_order();
DROP TRIGGER IF EXISTS orders_update_buyer_notification ON orders;
CREATE TRIGGER orders_update_buyer_notification
AFTER UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION notify_reseller_order();

CREATE OR REPLACE FUNCTION notify_reseller_payment_method()
RETURNS TRIGGER AS $$
DECLARE
  notification_title TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR
     NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND role = 'reseller') THEN
    RETURN NEW;
  END IF;

  notification_title := CASE NEW.status
    WHEN 'approved' THEN 'Payout account approved'
    WHEN 'rejected' THEN 'Payout account rejected'
    ELSE 'Payout account updated'
  END;
  INSERT INTO notifications (
    user_id, type, title, message, entity_type, entity_id, action_url
  ) VALUES (
    NEW.user_id, 'payment_method_' || NEW.status, notification_title,
    'Your ' || REPLACE(NEW.type, '_', ' ') || ' payout account is now ' ||
    NEW.status || '.', 'payment_method', NEW.id,
    '/dashboard/reseller/payment-methods'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_methods_update_notification ON payment_methods;
CREATE TRIGGER payment_methods_update_notification
AFTER UPDATE OF status ON payment_methods
FOR EACH ROW EXECUTE FUNCTION notify_reseller_payment_method();
