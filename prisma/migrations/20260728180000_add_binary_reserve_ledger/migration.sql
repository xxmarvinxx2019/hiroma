-- A reserve lot is the binary allocation created by one registration.
-- Every binary payout or binary flushout consumes these lots FIFO.
CREATE TABLE IF NOT EXISTS "binary_reserve_lots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "registration_financial_id" UUID NOT NULL,
  "original_amount" DECIMAL(12,2) NOT NULL,
  "remaining_amount" DECIMAL(12,2) NOT NULL,
  "snapshot_source" VARCHAR NOT NULL,
  "allocated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "binary_reserve_lots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "binary_reserve_lots_registration_financial_id_key" UNIQUE ("registration_financial_id"),
  CONSTRAINT "binary_reserve_lots_amount_non_negative" CHECK ("original_amount" >= 0 AND "remaining_amount" >= 0),
  CONSTRAINT "binary_reserve_lots_registration_fkey" FOREIGN KEY ("registration_financial_id") REFERENCES "registration_financials"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "binary_reserve_consumptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reserve_lot_id" UUID,
  "commission_id" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "is_unfunded" BOOLEAN NOT NULL DEFAULT false,
  "consumed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "binary_reserve_consumptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "binary_reserve_consumptions_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "binary_reserve_consumptions_lot_fkey" FOREIGN KEY ("reserve_lot_id") REFERENCES "binary_reserve_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "binary_reserve_consumptions_commission_fkey" FOREIGN KEY ("commission_id") REFERENCES "commissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "binary_reserve_lots_remaining_allocated_idx"
ON "binary_reserve_lots" ("remaining_amount", "allocated_at");
CREATE INDEX IF NOT EXISTS "binary_reserve_consumptions_commission_idx"
ON "binary_reserve_consumptions" ("commission_id");
CREATE INDEX IF NOT EXISTS "binary_reserve_consumptions_lot_idx"
ON "binary_reserve_consumptions" ("reserve_lot_id");

-- Create a lot for every existing registration. New registrations are inserted
-- by the trigger below, so all reserve values have a single durable source.
INSERT INTO "binary_reserve_lots" (
  "registration_financial_id", "original_amount", "remaining_amount", "snapshot_source", "allocated_at"
)
SELECT
  rf."id",
  rf."binary_commission_allocation",
  rf."binary_commission_allocation",
  rf."allocation_snapshot_source",
  rf."created_at"
FROM "registration_financials" rf
ON CONFLICT ("registration_financial_id") DO NOTHING;

CREATE OR REPLACE FUNCTION "consume_binary_reserve"()
RETURNS TRIGGER AS $$
DECLARE
  remaining DECIMAL(12,2);
  lot RECORD;
  consumed DECIMAL(12,2);
BEGIN
  IF NEW."type" <> 'binary_pairing' OR NEW."amount" <= 0 THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM "binary_reserve_consumptions" WHERE "commission_id" = NEW."id") THEN
    RETURN NEW;
  END IF;

  remaining := NEW."amount";
  WHILE remaining > 0 LOOP
    SELECT "id", "remaining_amount"
    INTO lot
    FROM "binary_reserve_lots"
    WHERE "remaining_amount" > 0
    ORDER BY "allocated_at" ASC, "id" ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO "binary_reserve_consumptions" ("commission_id", "amount", "is_unfunded", "consumed_at")
      VALUES (NEW."id", remaining, true, NEW."created_at");
      EXIT;
    END IF;

    consumed := LEAST(remaining, lot."remaining_amount");
    UPDATE "binary_reserve_lots"
    SET "remaining_amount" = "remaining_amount" - consumed
    WHERE "id" = lot."id";
    INSERT INTO "binary_reserve_consumptions" ("reserve_lot_id", "commission_id", "amount", "is_unfunded", "consumed_at")
    VALUES (lot."id", NEW."id", consumed, false, NEW."created_at");
    remaining := remaining - consumed;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "commissions_consume_binary_reserve" ON "commissions";
CREATE TRIGGER "commissions_consume_binary_reserve"
AFTER INSERT ON "commissions"
FOR EACH ROW EXECUTE FUNCTION "consume_binary_reserve"();

-- Reconstruct historical consumption in timestamp order. This is explicitly
-- labelled as FIFO reconstruction in reporting because older records did not
-- preserve their original lot-to-payout link.
DO $$
DECLARE
  commission_row RECORD;
  lot RECORD;
  remaining DECIMAL(12,2);
  consumed DECIMAL(12,2);
BEGIN
  FOR commission_row IN
    SELECT c."id", c."amount", c."created_at"
    FROM "commissions" c
    WHERE c."type" = 'binary_pairing'
      AND c."amount" > 0
      AND NOT EXISTS (
        SELECT 1 FROM "binary_reserve_consumptions" rc WHERE rc."commission_id" = c."id"
      )
    ORDER BY c."created_at" ASC, c."id" ASC
  LOOP
    remaining := commission_row."amount";
    WHILE remaining > 0 LOOP
      SELECT "id", "remaining_amount"
      INTO lot
      FROM "binary_reserve_lots"
      WHERE "remaining_amount" > 0
      ORDER BY "allocated_at" ASC, "id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO "binary_reserve_consumptions" ("commission_id", "amount", "is_unfunded", "consumed_at")
        VALUES (commission_row."id", remaining, true, commission_row."created_at");
        EXIT;
      END IF;

      consumed := LEAST(remaining, lot."remaining_amount");
      UPDATE "binary_reserve_lots"
      SET "remaining_amount" = "remaining_amount" - consumed
      WHERE "id" = lot."id";
      INSERT INTO "binary_reserve_consumptions" ("reserve_lot_id", "commission_id", "amount", "is_unfunded", "consumed_at")
      VALUES (lot."id", commission_row."id", consumed, false, commission_row."created_at");
      remaining := remaining - consumed;
    END LOOP;
  END LOOP;
END $$;
