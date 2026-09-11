BEGIN;

ALTER TABLE "payouts"
  ADD COLUMN IF NOT EXISTS "disbursement_provider" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "external_reference" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "disbursed_amount" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "disbursed_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "released_by" TEXT;

ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_released_by_fkey"
  FOREIGN KEY ("released_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "payouts_disbursement_provider_external_reference_key"
  ON "payouts" ("disbursement_provider", "external_reference");

CREATE OR REPLACE FUNCTION "protect_payout_disbursement_evidence"()
RETURNS TRIGGER AS $$
DECLARE
  releaser_role TEXT;
  releaser_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."disbursement_provider" IS NOT NULL OR NEW."external_reference" IS NOT NULL
       OR NEW."disbursed_amount" IS NOT NULL OR NEW."disbursed_at" IS NOT NULL
       OR NEW."released_by" IS NOT NULL THEN
      RAISE EXCEPTION 'A new payout cannot contain premature disbursement evidence.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'approved'::"PayoutStatus" AND NEW."status" = 'released'::"PayoutStatus" THEN
    IF NEW."disbursement_provider" IS NULL OR length(btrim(NEW."disbursement_provider")) = 0
       OR NEW."external_reference" IS NULL OR length(btrim(NEW."external_reference")) = 0
       OR NEW."disbursed_amount" IS DISTINCT FROM NEW."amount"
       OR NEW."disbursed_at" IS NULL OR NEW."disbursed_at" > transaction_timestamp()
       OR NEW."released_by" IS NULL THEN
      RAISE EXCEPTION 'Payout release requires complete matching external disbursement evidence.' USING ERRCODE = '23514';
    END IF;
    SELECT "role"::TEXT, "status"::TEXT INTO releaser_role, releaser_status
    FROM "users" WHERE "id" = NEW."released_by" FOR SHARE;
    IF releaser_role <> 'admin' OR releaser_status <> 'active' THEN
      RAISE EXCEPTION 'Payout releaser must be an active administrator.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."disbursement_provider" IS DISTINCT FROM OLD."disbursement_provider"
     OR NEW."external_reference" IS DISTINCT FROM OLD."external_reference"
     OR NEW."disbursed_amount" IS DISTINCT FROM OLD."disbursed_amount"
     OR NEW."disbursed_at" IS DISTINCT FROM OLD."disbursed_at"
     OR NEW."released_by" IS DISTINCT FROM OLD."released_by" THEN
    RAISE EXCEPTION 'Disbursement evidence is immutable and may be recorded only during release.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "protect_payout_disbursement_evidence_trigger" ON "payouts";
CREATE TRIGGER "protect_payout_disbursement_evidence_trigger"
BEFORE INSERT OR UPDATE ON "payouts"
FOR EACH ROW EXECUTE FUNCTION "protect_payout_disbursement_evidence"();

REVOKE ALL ON FUNCTION "protect_payout_disbursement_evidence"() FROM PUBLIC;

COMMIT;
