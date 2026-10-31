BEGIN;
LOCK TABLE product_binary_positions, product_binary_pair_events IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE product_binary_pu_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id TEXT NOT NULL REFERENCES users(id),
  order_event_id UUID NOT NULL REFERENCES product_binary_order_events(id),
  leg TEXT NOT NULL CHECK (leg IN ('left','right')),
  original_pu INTEGER NOT NULL CHECK (original_pu > 0),
  remaining_pu INTEGER NOT NULL CHECK (remaining_pu >= 0),
  consumed_pu INTEGER NOT NULL DEFAULT 0 CHECK (consumed_pu >= 0),
  expired_pu INTEGER NOT NULL DEFAULT 0 CHECK (expired_pu >= 0),
  earned_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  expired_at TIMESTAMPTZ,
  UNIQUE(recipient_user_id, order_event_id),
  CHECK (original_pu = remaining_pu + consumed_pu + expired_pu),
  CHECK (expires_at > earned_at)
);
CREATE INDEX product_binary_pu_fifo ON product_binary_pu_lots(recipient_user_id, leg, earned_at, id) WHERE remaining_pu > 0;
CREATE INDEX product_binary_pu_expiry ON product_binary_pu_lots(expires_at, recipient_user_id) WHERE remaining_pu > 0;

-- Reconstruct outstanding volume using historical FIFO consumption. Previously
-- paid/flashout pairs remain unchanged; only their unused source PU is dated.
WITH sources AS (
  SELECT p.*, COALESCE(j.qualified_at, o.processed_at) AS earned_at,
    SUM(p.source_pu) OVER (PARTITION BY p.recipient_user_id,p.source_leg ORDER BY p.created_at,p.id) AS cumulative_pu
  FROM product_binary_pair_events p
  JOIN product_binary_order_events o ON o.id=p.order_event_id
  LEFT JOIN product_binary_settlement_jobs j ON j.id=o.settlement_job_id
), used AS (
  SELECT recipient_user_id, SUM(completed_pairs)*2 AS consumed FROM product_binary_pair_events GROUP BY recipient_user_id
)
INSERT INTO product_binary_pu_lots(recipient_user_id,order_event_id,leg,original_pu,remaining_pu,consumed_pu,earned_at,expires_at)
SELECT s.recipient_user_id,s.order_event_id,s.source_leg,s.source_pu,
  LEAST(s.source_pu,GREATEST(0,s.cumulative_pu-u.consumed))::int,
  (s.source_pu-LEAST(s.source_pu,GREATEST(0,s.cumulative_pu-u.consumed)))::int,
  s.earned_at, ((s.earned_at AT TIME ZONE 'Asia/Manila') + INTERVAL '1 year') AT TIME ZONE 'Asia/Manila'
FROM sources s JOIN used u USING(recipient_user_id) WHERE s.source_pu>0;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM product_binary_positions p LEFT JOIN (
      SELECT recipient_user_id,
        COALESCE(SUM(remaining_pu) FILTER(WHERE leg='left'),0) l,
        COALESCE(SUM(remaining_pu) FILTER(WHERE leg='right'),0) r
      FROM product_binary_pu_lots GROUP BY recipient_user_id
    ) v ON v.recipient_user_id=p.user_id
    WHERE p.left_carryover_pu<>COALESCE(v.l,0) OR p.right_carryover_pu<>COALESCE(v.r,0)
  ) THEN RAISE EXCEPTION 'Existing Product PU cannot be reconciled to order history; migration stopped without changing balances.';
  END IF;
END $$;

CREATE FUNCTION expire_product_binary_pu(target_user TEXT, as_of TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE lost INTEGER; lost_left INTEGER; lost_right INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('product-binary-user:' || target_user));
  PERFORM 1 FROM product_binary_positions WHERE user_id=target_user FOR UPDATE;
  WITH expired AS (
    UPDATE product_binary_pu_lots SET expired_pu=expired_pu+remaining_pu,
      remaining_pu=0,expired_at=as_of
    WHERE recipient_user_id=target_user AND remaining_pu>0 AND expires_at<=as_of
    RETURNING leg,expired_pu
  ) SELECT COALESCE(SUM(expired_pu),0),COALESCE(SUM(expired_pu) FILTER(WHERE leg='left'),0),
    COALESCE(SUM(expired_pu) FILTER(WHERE leg='right'),0) INTO lost,lost_left,lost_right FROM expired;
  UPDATE product_binary_positions SET left_carryover_pu=left_carryover_pu-lost_left,
    right_carryover_pu=right_carryover_pu-lost_right,updated_at=CURRENT_TIMESTAMP
    WHERE user_id=target_user AND lost>0;
  RETURN lost;
END $$;
COMMIT;
