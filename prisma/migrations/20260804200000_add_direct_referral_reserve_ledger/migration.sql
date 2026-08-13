-- Direct-referral income is an amount payable to the referring reseller until
-- it is allocated to an approved payout. Flashout rows are excluded entirely.
CREATE TABLE IF NOT EXISTS "direct_referral_reserve_lots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "commission_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "original_amount" DECIMAL(12,2) NOT NULL,
  "remaining_amount" DECIMAL(12,2) NOT NULL,
  "snapshot_source" VARCHAR NOT NULL,
  "allocated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "direct_referral_reserve_lots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "direct_referral_reserve_lots_commission_id_key" UNIQUE ("commission_id"),
  CONSTRAINT "direct_referral_reserve_lots_amount_non_negative" CHECK ("original_amount" >= 0 AND "remaining_amount" >= 0),
  CONSTRAINT "direct_referral_reserve_lots_commission_fkey" FOREIGN KEY ("commission_id") REFERENCES "commissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "direct_referral_payout_consumptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payout_id" TEXT NOT NULL,
  "reserve_lot_id" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "allocated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "direct_referral_payout_consumptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "direct_referral_payout_consumptions_payout_lot_key" UNIQUE ("payout_id", "reserve_lot_id"),
  CONSTRAINT "direct_referral_payout_consumptions_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "direct_referral_payout_consumptions_payout_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "direct_referral_payout_consumptions_lot_fkey" FOREIGN KEY ("reserve_lot_id") REFERENCES "direct_referral_reserve_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "direct_referral_reserve_lots_member_remaining_idx"
ON "direct_referral_reserve_lots" ("user_id", "remaining_amount", "allocated_at");
CREATE INDEX IF NOT EXISTS "direct_referral_payout_consumptions_payout_idx"
ON "direct_referral_payout_consumptions" ("payout_id");
CREATE INDEX IF NOT EXISTS "direct_referral_payout_consumptions_lot_idx"
ON "direct_referral_payout_consumptions" ("reserve_lot_id");

-- One reserve lot per normal direct-referral commission. Existing rows are
-- reconstructed so the ledger starts with the complete income history.
INSERT INTO "direct_referral_reserve_lots" (
  "commission_id", "user_id", "original_amount", "remaining_amount", "snapshot_source", "allocated_at"
)
SELECT c."id", c."user_id", c."amount", c."amount", 'historical_reconstruction', c."created_at"
FROM "commissions" c
WHERE c."type" = 'direct_referral'
  AND c."is_pair_overflow" = false
  AND c."amount" > 0
ON CONFLICT ("commission_id") DO NOTHING;

CREATE OR REPLACE FUNCTION "allocate_direct_referral_payout"(
  target_payout_id TEXT,
  target_user_id TEXT,
  payout_amount DECIMAL(12,2),
  allocation_time TIMESTAMP(3)
)
RETURNS VOID AS $$
DECLARE
  remaining DECIMAL(12,2);
  lot RECORD;
  consumed DECIMAL(12,2);
BEGIN
  IF payout_amount <= 0 THEN
    RETURN;
  END IF;

  -- Serialize all FIFO reserve allocation for one member. Waiting for a lot is
  -- required: lock contention must never be interpreted as exhausted funds.
  PERFORM pg_advisory_xact_lock(hashtextextended(target_user_id, 0));

  SELECT GREATEST(payout_amount - COALESCE(SUM("amount"), 0), 0)
  INTO remaining
  FROM "direct_referral_payout_consumptions"
  WHERE "payout_id" = target_payout_id;

  WHILE remaining > 0 LOOP
    SELECT "id", "remaining_amount"
    INTO lot
    FROM "direct_referral_reserve_lots"
    WHERE "user_id" = target_user_id
      AND "remaining_amount" > 0
      AND "allocated_at" <= allocation_time
    ORDER BY "allocated_at" ASC, "id" ASC
    FOR UPDATE
    LIMIT 1;

    EXIT WHEN NOT FOUND;

    consumed := LEAST(remaining, lot."remaining_amount");
    UPDATE "direct_referral_reserve_lots"
    SET "remaining_amount" = "remaining_amount" - consumed
    WHERE "id" = lot."id";

    INSERT INTO "direct_referral_payout_consumptions" (
      "payout_id", "reserve_lot_id", "amount", "allocated_at"
    ) VALUES (
      target_payout_id, lot."id", consumed, allocation_time
    );
    remaining := remaining - consumed;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- New normal direct-referral credits automatically become payable reserve lots.
CREATE OR REPLACE FUNCTION "create_direct_referral_reserve_lot"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."type" = 'direct_referral'
    AND NEW."is_pair_overflow" = false
    AND NEW."amount" > 0 THEN
    INSERT INTO "direct_referral_reserve_lots" (
      "commission_id", "user_id", "original_amount", "remaining_amount", "snapshot_source", "allocated_at"
    ) VALUES (
      NEW."id", NEW."user_id", NEW."amount", NEW."amount", 'commission_credit', NEW."created_at"
    ) ON CONFLICT ("commission_id") DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "commissions_create_direct_referral_reserve" ON "commissions";
CREATE TRIGGER "commissions_create_direct_referral_reserve"
AFTER INSERT ON "commissions"
FOR EACH ROW EXECUTE FUNCTION "create_direct_referral_reserve_lot"();

-- Approval commits the direct-referral portion of a payout. The release job
-- still controls the actual wallet deduction and payment release date.
CREATE OR REPLACE FUNCTION "allocate_approved_direct_referral_payout"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" = 'approved' AND (TG_OP = 'INSERT' OR OLD."status" <> 'approved') THEN
    PERFORM "allocate_direct_referral_payout"(
      NEW."id", NEW."user_id", NEW."amount", COALESCE(NEW."processed_at", CURRENT_TIMESTAMP)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "payouts_allocate_direct_referral_reserve" ON "payouts";
CREATE TRIGGER "payouts_allocate_direct_referral_reserve"
AFTER INSERT OR UPDATE OF "status" ON "payouts"
FOR EACH ROW EXECUTE FUNCTION "allocate_approved_direct_referral_payout"();

-- Historical payouts did not retain a commission-type split. Reconstruct them
-- deterministically using direct-referral-first FIFO, per member and payout.
DO $$
DECLARE
  payout_row RECORD;
BEGIN
  FOR payout_row IN
    SELECT "id", "user_id", "amount", COALESCE("processed_at", "requested_at") AS "allocation_time"
    FROM "payouts"
    WHERE "status" IN ('approved', 'released')
    ORDER BY COALESCE("processed_at", "requested_at") ASC, "id" ASC
  LOOP
    PERFORM "allocate_direct_referral_payout"(
      payout_row."id", payout_row."user_id", payout_row."amount", payout_row."allocation_time"
    );
  END LOOP;
END $$;
