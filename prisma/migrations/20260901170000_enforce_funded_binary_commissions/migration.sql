-- A positive binary commission must never exist unless the shared binary
-- reserve can fund it in full. Raising here aborts the commission insert and
-- therefore also aborts wallet credit and the surrounding registration or
-- upgrade transaction.
BEGIN;

-- Close the deployment race between historical-shortfall preflight and
-- installing the fail-closed trigger. Reads continue; commission writers wait
-- until this entire migration commits.
LOCK TABLE "commissions" IN SHARE ROW EXCLUSIVE MODE;

ALTER TYPE "CommissionType"
ADD VALUE IF NOT EXISTS 'deactivation_wallet_transfer';

-- Historical unfunded rows may already have affected wallets or released
-- payouts. Do not claim enforcement is complete until an operator reconciles
-- those liabilities explicitly.
DO $$
DECLARE
  historical_count BIGINT;
  historical_amount DECIMAL(12,2);
BEGIN
  SELECT COUNT(*), COALESCE(SUM("amount"), 0)
  INTO historical_count, historical_amount
  FROM "binary_reserve_consumptions"
  WHERE "is_unfunded" = true;

  IF historical_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Historical unfunded binary commissions require reconciliation.',
      DETAIL = format(
        'unfunded_consumptions=%s unfunded_amount=%s',
        historical_count,
        historical_amount
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "consume_binary_reserve"()
RETURNS TRIGGER AS $$
DECLARE
  remaining DECIMAL(12,2);
  available DECIMAL(12,2);
  lot RECORD;
  consumed DECIMAL(12,2);
BEGIN
  IF NEW."type" <> 'binary_pairing' OR NEW."amount" <= 0 THEN
    RETURN NEW;
  END IF;

  -- Every binary commission competes for one global FIFO reserve. Serialize
  -- this check-and-consume sequence so concurrent credits cannot both approve
  -- the same remaining funds.
  PERFORM pg_advisory_xact_lock(hashtext('binary-reserve-funding'));

  IF EXISTS (
    SELECT 1
    FROM "binary_reserve_consumptions"
    WHERE "commission_id" = NEW."id"
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM("remaining_amount"), 0)
  INTO available
  FROM "binary_reserve_lots"
  WHERE "remaining_amount" > 0;

  IF available < NEW."amount" THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Binary commission reserve is insufficient.',
      DETAIL = format(
        'commission_id=%s required=%s available=%s',
        NEW."id",
        NEW."amount",
        available
      );
  END IF;

  remaining := NEW."amount";
  WHILE remaining > 0 LOOP
    SELECT "id", "remaining_amount"
    INTO lot
    FROM "binary_reserve_lots"
    WHERE "remaining_amount" > 0
    ORDER BY "allocated_at" ASC, "id" ASC
    FOR UPDATE
    LIMIT 1;

    -- The advisory lock and pre-check make this unreachable for cooperating
    -- writers. Keep it fail-closed if the ledger is changed unexpectedly.
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'Binary commission reserve changed during consumption.',
        DETAIL = format(
          'commission_id=%s remaining_required=%s',
          NEW."id",
          remaining
        );
    END IF;

    consumed := LEAST(remaining, lot."remaining_amount");
    UPDATE "binary_reserve_lots"
    SET "remaining_amount" = "remaining_amount" - consumed
    WHERE "id" = lot."id";

    INSERT INTO "binary_reserve_consumptions" (
      "reserve_lot_id",
      "commission_id",
      "amount",
      "is_unfunded",
      "consumed_at"
    )
    VALUES (
      lot."id",
      NEW."id",
      consumed,
      false,
      NEW."created_at"
    );

    remaining := remaining - consumed;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
