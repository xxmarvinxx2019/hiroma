ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "batch_id" VARCHAR(40);

UPDATE "payouts"
SET "batch_id" = 'PAYOUT-' || to_char("cutoff_date", 'YYYYMMDD')
WHERE "batch_id" IS NULL AND "cutoff_date" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "payouts_batch_id_status_idx" ON "payouts"("batch_id", "status");

CREATE OR REPLACE FUNCTION "protect_payout_batch_identity"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (NEW."batch_id" IS NULL OR length(btrim(NEW."batch_id")) = 0) THEN
    RAISE EXCEPTION 'A payout requires an immutable batch identifier.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."batch_id" IS DISTINCT FROM OLD."batch_id" THEN
    RAISE EXCEPTION 'Payout batch identity is immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "protect_payout_batch_identity_trigger" ON "payouts";
CREATE TRIGGER "protect_payout_batch_identity_trigger"
BEFORE INSERT OR UPDATE OF "batch_id" ON "payouts"
FOR EACH ROW EXECUTE FUNCTION "protect_payout_batch_identity"();
