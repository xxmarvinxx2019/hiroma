-- Preserve the existing Product Binary funding rules while making one
-- commission's funding allocation safe under retries and concurrency.
-- CREATE OR REPLACE retains the owner-only EXECUTE privileges established by
-- 20260813140000_restrict_financial_function_execution.
CREATE OR REPLACE FUNCTION public.consume_product_binary_funding(
  target_commission_id TEXT,
  target_amount DECIMAL(12,2),
  at_time TIMESTAMPTZ
) RETURNS VOID AS $$
DECLARE
  remaining DECIMAL(12,2);
  lot RECORD;
  used DECIMAL(12,2);
BEGIN
  IF target_amount <= 0 THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(target_commission_id, 0));

  IF EXISTS (
    SELECT 1 FROM product_binary_funding_consumptions
    WHERE commission_id = target_commission_id
  ) THEN
    RETURN;
  END IF;

  remaining := target_amount;
  WHILE remaining > 0 LOOP
    SELECT id, remaining_amount INTO lot
    FROM product_binary_funding_lots
    WHERE remaining_amount > 0 AND allocated_at <= at_time
    ORDER BY allocated_at, id
    FOR UPDATE
    LIMIT 1;

    EXIT WHEN NOT FOUND;
    used := LEAST(remaining, lot.remaining_amount);
    UPDATE product_binary_funding_lots
    SET remaining_amount = remaining_amount - used
    WHERE id = lot.id;
    INSERT INTO product_binary_funding_consumptions(
      funding_lot_id, commission_id, amount, is_unfunded, consumed_at
    ) VALUES (
      lot.id, target_commission_id, used, false, at_time
    );
    remaining := remaining - used;
  END LOOP;

  IF remaining > 0 THEN
    INSERT INTO product_binary_funding_consumptions(
      funding_lot_id, commission_id, amount, is_unfunded, consumed_at
    ) VALUES (
      NULL, target_commission_id, remaining, true, at_time
    );
  END IF;
END;
$$ LANGUAGE plpgsql;
