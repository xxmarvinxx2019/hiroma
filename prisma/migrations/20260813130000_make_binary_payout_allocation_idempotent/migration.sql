-- Serialize every allocator for the same member and payout, and record each consumption
-- before reducing its payable lot. This preserves the existing allocation
-- order while making retries and concurrent calls idempotent.
CREATE OR REPLACE FUNCTION "allocate_binary_payout"(
  target_payout_id TEXT,
  target_user_id TEXT,
  payout_amount DECIMAL(12,2),
  allocation_time TIMESTAMPTZ
) RETURNS VOID AS $$
DECLARE
  direct_used DECIMAL(12,2);
  binary_used DECIMAL(12,2);
  remaining DECIMAL(12,2);
  lot RECORD;
  consumed DECIMAL(12,2);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_user_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(target_payout_id, 0));

  SELECT COALESCE(SUM("amount"), 0) INTO direct_used
  FROM "direct_referral_payout_consumptions" WHERE "payout_id" = target_payout_id;
  SELECT COALESCE(SUM("amount"), 0) INTO binary_used
  FROM "binary_payout_consumptions" WHERE "payout_id" = target_payout_id;
  remaining := GREATEST(payout_amount - direct_used - binary_used, 0);

  WHILE remaining > 0 LOOP
    SELECT l."id", l."remaining_amount" INTO lot
    FROM "binary_payable_lots" l
    WHERE l."user_id" = target_user_id
      AND l."remaining_amount" > 0
      AND l."allocated_at" <= allocation_time
      AND NOT EXISTS (
        SELECT 1 FROM "binary_payout_consumptions" c
        WHERE c."payout_id" = target_payout_id AND c."payable_lot_id" = l."id"
      )
    ORDER BY l."allocated_at" ASC, l."id" ASC
    FOR UPDATE OF l LIMIT 1;
    EXIT WHEN NOT FOUND;

    consumed := LEAST(remaining, lot."remaining_amount");
    INSERT INTO "binary_payout_consumptions" ("payout_id", "payable_lot_id", "amount", "allocated_at")
    VALUES (target_payout_id, lot."id", consumed, allocation_time);
    UPDATE "binary_payable_lots"
    SET "remaining_amount" = "remaining_amount" - consumed
    WHERE "id" = lot."id";
    remaining := remaining - consumed;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "allocate_product_binary_payout"(
  target_payout_id TEXT,
  target_user_id TEXT,
  payout_amount DECIMAL(12,2),
  allocation_time TIMESTAMPTZ
) RETURNS VOID AS $$
DECLARE
  used DECIMAL(12,2);
  remaining DECIMAL(12,2);
  lot RECORD;
  consumed DECIMAL(12,2);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_user_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(target_payout_id, 0));

  SELECT COALESCE(SUM(x.amount), 0) INTO used FROM (
    SELECT amount FROM direct_referral_payout_consumptions WHERE payout_id = target_payout_id
    UNION ALL SELECT amount FROM binary_payout_consumptions WHERE payout_id = target_payout_id
    UNION ALL SELECT amount FROM product_binary_payout_consumptions WHERE payout_id = target_payout_id
  ) x;
  remaining := GREATEST(payout_amount - used, 0);

  WHILE remaining > 0 LOOP
    SELECT l.id, l.remaining_amount INTO lot
    FROM product_binary_payable_lots l
    WHERE l.user_id = target_user_id
      AND l.remaining_amount > 0
      AND l.allocated_at <= allocation_time
      AND NOT EXISTS (
        SELECT 1 FROM product_binary_payout_consumptions c
        WHERE c.payout_id = target_payout_id AND c.payable_lot_id = l.id
      )
    ORDER BY l.allocated_at, l.id
    FOR UPDATE OF l LIMIT 1;
    EXIT WHEN NOT FOUND;

    consumed := LEAST(remaining, lot.remaining_amount);
    INSERT INTO product_binary_payout_consumptions(payout_id, payable_lot_id, amount, allocated_at)
    VALUES(target_payout_id, lot.id, consumed, allocation_time);
    UPDATE product_binary_payable_lots
    SET remaining_amount = remaining_amount - consumed
    WHERE id = lot.id;
    remaining := remaining - consumed;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
