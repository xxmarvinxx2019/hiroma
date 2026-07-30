-- Persist transaction notifications for every account role, not only resellers.
-- The existing bell already reads this notifications table for Admin, Regional,
-- Provincial, City Distributor, and Reseller dashboards.

CREATE OR REPLACE FUNCTION notification_order_route(target_user_id TEXT)
RETURNS TEXT AS $$
  SELECT CASE role::text
    WHEN 'admin' THEN '/dashboard/admin/orders'
    WHEN 'regional' THEN '/dashboard/regional/orders'
    WHEN 'provincial' THEN '/dashboard/provincial/orders'
    WHEN 'city' THEN '/dashboard/city/orders'
    WHEN 'reseller' THEN '/dashboard/reseller/orders'
    ELSE NULL
  END
  FROM users
  WHERE id::text = target_user_id
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION notification_payment_method_route(target_user_id TEXT)
RETURNS TEXT AS $$
  SELECT CASE role::text
    WHEN 'admin' THEN '/dashboard/admin/payment-methods'
    WHEN 'regional' THEN '/dashboard/regional/payment-methods'
    WHEN 'provincial' THEN '/dashboard/provincial/payment-methods'
    WHEN 'city' THEN '/dashboard/city/payment-methods'
    WHEN 'reseller' THEN '/dashboard/reseller/payment-methods'
    ELSE NULL
  END
  FROM users
  WHERE id::text = target_user_id
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION notify_all_account_commission()
RETURNS TRIGGER AS $$
DECLARE
  notification_title TEXT;
  notification_message TEXT;
  action_url TEXT;
BEGIN
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

  SELECT CASE role::text
    WHEN 'admin' THEN '/dashboard/admin/commissions'
    WHEN 'regional' THEN '/dashboard/regional'
    WHEN 'provincial' THEN '/dashboard/provincial'
    WHEN 'city' THEN '/dashboard/city/reports'
    WHEN 'reseller' THEN '/dashboard/reseller/wallet'
    ELSE NULL
  END INTO action_url
  FROM users WHERE id::text = NEW.user_id::text;

  INSERT INTO notifications (
    user_id, type, title, message, amount, entity_type, entity_id, action_url
  ) VALUES (
    NEW.user_id, NEW.type::text, notification_title, notification_message,
    NEW.amount, 'commission', NEW.id, action_url
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS commissions_create_notification ON commissions;
CREATE TRIGGER commissions_create_notification
AFTER INSERT ON commissions
FOR EACH ROW EXECUTE FUNCTION notify_all_account_commission();

CREATE OR REPLACE FUNCTION notify_all_account_payout()
RETURNS TRIGGER AS $$
DECLARE
  notification_title TEXT;
  notification_message TEXT;
  action_url TEXT;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  notification_title := CASE NEW.status::text
    WHEN 'approved' THEN 'Payout approved'
    WHEN 'rejected' THEN 'Payout rejected'
    WHEN 'released' THEN 'Payout released'
    ELSE 'Payout updated'
  END;
  notification_message := 'Your payout of ₱' ||
    TO_CHAR(NEW.amount, 'FM999,999,990.00') || ' is now ' || NEW.status::text || '.';

  SELECT CASE role::text
    WHEN 'admin' THEN '/dashboard/admin/payouts'
    WHEN 'reseller' THEN '/dashboard/reseller/payouts'
    ELSE NULL
  END INTO action_url
  FROM users WHERE id::text = NEW.user_id::text;

  INSERT INTO notifications (
    user_id, type, title, message, amount, entity_type, entity_id, action_url
  ) VALUES (
    NEW.user_id, 'payout_' || NEW.status::text, notification_title,
    notification_message, NEW.amount, 'payout', NEW.id, action_url
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payouts_create_notification ON payouts;
DROP TRIGGER IF EXISTS payouts_update_notification ON payouts;
CREATE TRIGGER payouts_update_notification
AFTER UPDATE OF status ON payouts
FOR EACH ROW EXECUTE FUNCTION notify_all_account_payout();

CREATE OR REPLACE FUNCTION notify_all_order_parties()
RETURNS TRIGGER AS $$
DECLARE
  notification_title TEXT;
  notification_message TEXT;
BEGIN
  -- A newly placed order belongs in the supplier/seller's bell.
  IF TG_OP = 'INSERT' THEN
    IF NEW.seller_id <> NEW.buyer_id THEN
      INSERT INTO notifications (
        user_id, type, title, message, amount, entity_type, entity_id, action_url
      ) VALUES (
        NEW.seller_id, 'order_placed', 'New order received',
        'A new order' || COALESCE(' ' || NEW.order_number, '') ||
        ' worth ₱' || TO_CHAR(NEW.total_amount, 'FM999,999,990.00') || ' was placed.',
        NEW.total_amount, 'order', NEW.id, notification_order_route(NEW.seller_id::text)
      );
    END IF;
    RETURN NEW;
  END IF;

  -- Any later status change belongs in the buyer's bell, whatever their role.
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.buyer_id = NEW.seller_id THEN
    RETURN NEW;
  END IF;

  notification_title := CASE NEW.status::text
    WHEN 'processing' THEN 'Order is processing'
    WHEN 'ready_for_pickup' THEN 'Order ready for pickup'
    WHEN 'delivered' THEN 'Order delivered'
    WHEN 'cancelled' THEN 'Order cancelled'
    ELSE 'Order updated'
  END;
  notification_message := 'Your order' || COALESCE(' ' || NEW.order_number, '') ||
    ' is now ' || REPLACE(NEW.status::text, '_', ' ') || '.';

  INSERT INTO notifications (
    user_id, type, title, message, amount, entity_type, entity_id, action_url
  ) VALUES (
    NEW.buyer_id, 'order_' || NEW.status::text, notification_title,
    notification_message, NEW.total_amount, 'order', NEW.id,
    notification_order_route(NEW.buyer_id::text)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_create_buyer_notification ON orders;
DROP TRIGGER IF EXISTS orders_update_buyer_notification ON orders;
CREATE TRIGGER orders_create_buyer_notification
AFTER INSERT ON orders
FOR EACH ROW EXECUTE FUNCTION notify_all_order_parties();
CREATE TRIGGER orders_update_buyer_notification
AFTER UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION notify_all_order_parties();

CREATE OR REPLACE FUNCTION notify_all_account_payment_method()
RETURNS TRIGGER AS $$
DECLARE
  notification_title TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
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
    'Your ' || REPLACE(NEW.type, '_', ' ') || ' payout account is now ' || NEW.status || '.',
    'payment_method', NEW.id, notification_payment_method_route(NEW.user_id::text)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_methods_update_notification ON payment_methods;
CREATE TRIGGER payment_methods_update_notification
AFTER UPDATE OF status ON payment_methods
FOR EACH ROW EXECUTE FUNCTION notify_all_account_payment_method();
