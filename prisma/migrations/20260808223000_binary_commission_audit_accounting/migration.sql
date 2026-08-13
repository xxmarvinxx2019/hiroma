-- Separate exact binary pairing events, member payable liability, and the
-- existing company funding pool. Historical payable rows are reconstructed
-- from normal binary commissions; historical event detail remains explicitly
-- legacy because old rows did not preserve the exact pair/cap snapshot.

CREATE TABLE IF NOT EXISTS "binary_pair_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recipient_user_id" TEXT NOT NULL,
  "source_user_id" TEXT NOT NULL,
  "source_kind" VARCHAR NOT NULL,
  "source_leg" VARCHAR NOT NULL,
  "source_points" INTEGER NOT NULL,
  "points_per_pair" INTEGER NOT NULL,
  "peso_per_point" DECIMAL(8,4) NOT NULL,
  "completed_pairs" INTEGER NOT NULL,
  "payable_pairs" INTEGER NOT NULL,
  "cap_flashout_pairs" INTEGER NOT NULL,
  "inactive_flashout_pairs" INTEGER NOT NULL,
  "consumed_left_points" INTEGER NOT NULL,
  "consumed_right_points" INTEGER NOT NULL,
  "payable_amount" DECIMAL(12,2) NOT NULL,
  "flashout_amount" DECIMAL(12,2) NOT NULL,
  "cap_enabled" BOOLEAN NOT NULL,
  "cap_limit" INTEGER,
  "normal_commission_id" TEXT,
  "flashout_commission_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "binary_pair_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "binary_pair_events_counts_check" CHECK (
    "completed_pairs" >= 0 AND "payable_pairs" >= 0 AND
    "cap_flashout_pairs" >= 0 AND "inactive_flashout_pairs" >= 0 AND
    "completed_pairs" = "payable_pairs" + "cap_flashout_pairs" + "inactive_flashout_pairs"
  ),
  CONSTRAINT "binary_pair_events_amounts_check" CHECK ("payable_amount" >= 0 AND "flashout_amount" >= 0),
  CONSTRAINT "binary_pair_events_normal_commission_fkey" FOREIGN KEY ("normal_commission_id") REFERENCES "commissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "binary_pair_events_flashout_commission_fkey" FOREIGN KEY ("flashout_commission_id") REFERENCES "commissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "binary_pair_events_created_at_idx" ON "binary_pair_events"("created_at");
CREATE INDEX IF NOT EXISTS "binary_pair_events_recipient_created_idx" ON "binary_pair_events"("recipient_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "binary_pair_events_source_created_idx" ON "binary_pair_events"("source_user_id", "created_at");

CREATE TABLE IF NOT EXISTS "binary_payable_lots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "commission_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "original_amount" DECIMAL(12,2) NOT NULL,
  "remaining_amount" DECIMAL(12,2) NOT NULL,
  "allocated_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "binary_payable_lots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "binary_payable_lots_commission_key" UNIQUE ("commission_id"),
  CONSTRAINT "binary_payable_lots_amount_check" CHECK ("original_amount" >= 0 AND "remaining_amount" >= 0),
  CONSTRAINT "binary_payable_lots_commission_fkey" FOREIGN KEY ("commission_id") REFERENCES "commissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "binary_payout_consumptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payout_id" TEXT NOT NULL,
  "payable_lot_id" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "allocated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "binary_payout_consumptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "binary_payout_consumptions_payout_lot_key" UNIQUE ("payout_id", "payable_lot_id"),
  CONSTRAINT "binary_payout_consumptions_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "binary_payout_consumptions_payout_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "binary_payout_consumptions_lot_fkey" FOREIGN KEY ("payable_lot_id") REFERENCES "binary_payable_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "binary_payable_lots_user_remaining_idx" ON "binary_payable_lots"("user_id", "remaining_amount", "allocated_at");
CREATE INDEX IF NOT EXISTS "binary_payout_consumptions_payout_idx" ON "binary_payout_consumptions"("payout_id");
CREATE INDEX IF NOT EXISTS "binary_payout_consumptions_lot_idx" ON "binary_payout_consumptions"("payable_lot_id");

INSERT INTO "binary_payable_lots" ("commission_id", "user_id", "original_amount", "remaining_amount", "allocated_at")
SELECT c."id", c."user_id", c."amount", c."amount", c."created_at"
FROM "commissions" c
WHERE c."type" = 'binary_pairing' AND c."is_pair_overflow" = false AND c."amount" > 0
ON CONFLICT ("commission_id") DO NOTHING;

CREATE OR REPLACE FUNCTION "create_binary_payable_lot"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."type" = 'binary_pairing' AND NEW."is_pair_overflow" = false AND NEW."amount" > 0 THEN
    INSERT INTO "binary_payable_lots" ("commission_id", "user_id", "original_amount", "remaining_amount", "allocated_at")
    VALUES (NEW."id", NEW."user_id", NEW."amount", NEW."amount", NEW."created_at")
    ON CONFLICT ("commission_id") DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "commissions_create_binary_payable" ON "commissions";
CREATE TRIGGER "commissions_create_binary_payable"
AFTER INSERT ON "commissions"
FOR EACH ROW EXECUTE FUNCTION "create_binary_payable_lot"();

CREATE OR REPLACE FUNCTION "allocate_binary_payout"(
  target_payout_id TEXT,
  target_user_id TEXT,
  payout_amount DECIMAL(12,2),
  allocation_time TIMESTAMPTZ
)
RETURNS VOID AS $$
DECLARE
  direct_used DECIMAL(12,2);
  binary_used DECIMAL(12,2);
  remaining DECIMAL(12,2);
  lot RECORD;
  consumed DECIMAL(12,2);
BEGIN
  SELECT COALESCE(SUM("amount"), 0) INTO direct_used
  FROM "direct_referral_payout_consumptions" WHERE "payout_id" = target_payout_id;
  SELECT COALESCE(SUM("amount"), 0) INTO binary_used
  FROM "binary_payout_consumptions" WHERE "payout_id" = target_payout_id;
  remaining := GREATEST(payout_amount - direct_used - binary_used, 0);

  WHILE remaining > 0 LOOP
    SELECT "id", "remaining_amount" INTO lot
    FROM "binary_payable_lots"
    WHERE "user_id" = target_user_id AND "remaining_amount" > 0 AND "allocated_at" <= allocation_time
    ORDER BY "allocated_at" ASC, "id" ASC
    FOR UPDATE SKIP LOCKED LIMIT 1;
    EXIT WHEN NOT FOUND;
    consumed := LEAST(remaining, lot."remaining_amount");
    UPDATE "binary_payable_lots" SET "remaining_amount" = "remaining_amount" - consumed WHERE "id" = lot."id";
    INSERT INTO "binary_payout_consumptions" ("payout_id", "payable_lot_id", "amount", "allocated_at")
    VALUES (target_payout_id, lot."id", consumed, allocation_time)
    ON CONFLICT ("payout_id", "payable_lot_id") DO NOTHING;
    remaining := remaining - consumed;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- PostgreSQL fires same-event triggers by name; the zz prefix makes this run
-- after the existing direct-referral-first allocator.
CREATE OR REPLACE FUNCTION "allocate_approved_binary_payout"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" = 'approved' AND (TG_OP = 'INSERT' OR OLD."status" <> 'approved') THEN
    PERFORM "allocate_binary_payout"(NEW."id", NEW."user_id", NEW."amount", COALESCE(NEW."processed_at", CURRENT_TIMESTAMP));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "zz_payouts_allocate_binary_payable" ON "payouts";
CREATE TRIGGER "zz_payouts_allocate_binary_payable"
AFTER INSERT OR UPDATE OF "status" ON "payouts"
FOR EACH ROW EXECUTE FUNCTION "allocate_approved_binary_payout"();

DO $$
DECLARE payout_row RECORD;
BEGIN
  FOR payout_row IN
    SELECT "id", "user_id", "amount", COALESCE("processed_at", "requested_at") AS allocation_time
    FROM "payouts" WHERE "status" IN ('approved', 'released')
    ORDER BY COALESCE("processed_at", "requested_at") ASC, "id" ASC
  LOOP
    PERFORM "allocate_binary_payout"(payout_row."id", payout_row."user_id", payout_row."amount", payout_row.allocation_time);
  END LOOP;
END $$;
