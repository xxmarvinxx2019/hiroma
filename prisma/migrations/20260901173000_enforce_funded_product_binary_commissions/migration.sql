-- Normal Product Binary earnings are external liabilities and must be funded
-- in full before their commission insert, carryover mutation, and wallet credit
-- can commit. Company-retained Product Binary flashouts remain reclassifications
-- and are excluded by the existing is_pair_overflow=false trigger condition.

BEGIN;

-- Prevent a Product Binary commission from being inserted after the legacy
-- shortfall preflight but before the replacement funding trigger is active.
LOCK TABLE "commissions" IN SHARE ROW EXCLUSIVE MODE;

-- Historical shortfalls may already have affected wallets or payouts. Require
-- explicit reconciliation rather than silently presenting future enforcement
-- as a complete fix.
DO $$
DECLARE
  historical_count BIGINT;
  historical_amount DECIMAL(12,2);
BEGIN
  SELECT COUNT(*), COALESCE(SUM("amount"), 0)
  INTO historical_count, historical_amount
  FROM "product_binary_funding_consumptions"
  WHERE "is_unfunded" = true;

  IF historical_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Historical unfunded Product Binary commissions require reconciliation.',
      DETAIL = format(
        'unfunded_consumptions=%s unfunded_amount=%s',
        historical_count,
        historical_amount
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.consume_product_binary_funding(
  target_commission_id TEXT,
  target_amount DECIMAL(12,2),
  at_time TIMESTAMPTZ
) RETURNS VOID AS $$
DECLARE
  remaining DECIMAL(12,2);
  available DECIMAL(12,2);
  lot RECORD;
  used DECIMAL(12,2);
BEGIN
  IF target_amount <= 0 THEN
    RETURN;
  END IF;

  -- The pool is global, so serialize the complete availability check and FIFO
  -- consumption instead of locking only one commission ID.
  PERFORM pg_advisory_xact_lock(hashtext('product-binary-funding'));

  IF EXISTS (
    SELECT 1
    FROM "product_binary_funding_consumptions"
    WHERE "commission_id" = target_commission_id
  ) THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM("remaining_amount"), 0)
  INTO available
  FROM "product_binary_funding_lots"
  WHERE "remaining_amount" > 0
    AND "allocated_at" <= at_time;

  IF available < target_amount THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Product Binary commission reserve is insufficient.',
      DETAIL = format(
        'commission_id=%s required=%s available=%s',
        target_commission_id,
        target_amount,
        available
      );
  END IF;

  remaining := target_amount;
  WHILE remaining > 0 LOOP
    SELECT "id", "remaining_amount"
    INTO lot
    FROM "product_binary_funding_lots"
    WHERE "remaining_amount" > 0
      AND "allocated_at" <= at_time
    ORDER BY "allocated_at" ASC, "id" ASC
    FOR UPDATE
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'Product Binary reserve changed during consumption.',
        DETAIL = format(
          'commission_id=%s remaining_required=%s',
          target_commission_id,
          remaining
        );
    END IF;

    used := LEAST(remaining, lot."remaining_amount");
    UPDATE "product_binary_funding_lots"
    SET "remaining_amount" = "remaining_amount" - used
    WHERE "id" = lot."id";

    INSERT INTO "product_binary_funding_consumptions" (
      "funding_lot_id",
      "commission_id",
      "amount",
      "is_unfunded",
      "consumed_at"
    )
    VALUES (
      lot."id",
      target_commission_id,
      used,
      false,
      at_time
    );

    remaining := remaining - used;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.fund_product_binary_commission()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."type" = 'sponsor_point'
    AND NEW."is_pair_overflow" = false
    AND NEW."amount" > 0
  THEN
    PERFORM public.consume_product_binary_funding(
      NEW."id",
      NEW."amount",
      NEW."created_at"
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "commissions_fund_product_binary" ON "commissions";
CREATE TRIGGER "commissions_fund_product_binary"
AFTER INSERT ON "commissions"
FOR EACH ROW EXECUTE FUNCTION public.fund_product_binary_commission();

COMMIT;
