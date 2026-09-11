BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "payout_destination_owners" (
  "destination_hash" VARCHAR(64) PRIMARY KEY,
  "identity_hash" VARCHAR(64) NOT NULL,
  "first_registered_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "payout_destination_owners_identity_hash_idx"
  ON "payout_destination_owners" ("identity_hash");

DO $$
DECLARE
  conflict_count BIGINT;
BEGIN
  WITH claims AS (
    SELECT encode(digest(
      lower(btrim(method."type")) || '|' ||
      lower(btrim(COALESCE(method."bank_name", ''))) || '|' ||
      upper(regexp_replace(method."account_number", '[^A-Za-z0-9]', '', 'g')),
      'sha256'
    ), 'hex') AS destination_hash,
    COUNT(DISTINCT usr."identity_document_hash") AS owners
    FROM "payment_methods" method
    JOIN "users" usr ON usr."id" = method."user_id"
    WHERE usr."role" = 'reseller'::"Role" AND usr."identity_document_hash" IS NOT NULL
      AND method."status" IN ('pending', 'approved')
    GROUP BY 1
  )
  SELECT COUNT(*) INTO conflict_count FROM claims WHERE owners > 1;
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Existing payout destinations are claimed by multiple verified identities.'
      USING ERRCODE = 'P0001', DETAIL = format('conflicting_destinations=%s', conflict_count),
      HINT = 'Resolve ownership from KYC and payment records before retrying. Do not choose an owner automatically.';
  END IF;
END $$;

INSERT INTO "payout_destination_owners" ("destination_hash", "identity_hash", "first_registered_by")
SELECT DISTINCT ON (destination_hash) destination_hash, identity_hash, user_id
FROM (
  SELECT encode(digest(
    lower(btrim(method."type")) || '|' || lower(btrim(COALESCE(method."bank_name", ''))) || '|' ||
    upper(regexp_replace(method."account_number", '[^A-Za-z0-9]', '', 'g')), 'sha256'
  ), 'hex') AS destination_hash,
  usr."identity_document_hash" AS identity_hash, usr."id" AS user_id, method."created_at"
  FROM "payment_methods" method JOIN "users" usr ON usr."id" = method."user_id"
  WHERE usr."role" = 'reseller'::"Role" AND usr."identity_document_hash" IS NOT NULL
    AND method."status" IN ('pending', 'approved')
) claims
ORDER BY destination_hash, created_at NULLS LAST, user_id;

CREATE OR REPLACE FUNCTION "enforce_reseller_payout_destination_owner"()
RETURNS TRIGGER AS $$
DECLARE
  account_role TEXT;
  owner_identity_hash VARCHAR(64);
  destination_hash_value VARCHAR(64);
  changed_count INTEGER;
BEGIN
  SELECT usr."role"::TEXT, usr."identity_document_hash"
  INTO account_role, owner_identity_hash
  FROM "users" usr WHERE usr."id" = NEW."user_id" FOR SHARE;
  IF account_role IS DISTINCT FROM 'reseller' THEN RETURN NEW; END IF;
  IF owner_identity_hash IS NULL OR length(owner_identity_hash) <> 64 THEN
    RAISE EXCEPTION 'A reseller needs a verified identity before registering a payout destination.' USING ERRCODE = '23514';
  END IF;
  destination_hash_value := encode(digest(
    lower(btrim(NEW."type")) || '|' || lower(btrim(COALESCE(NEW."bank_name", ''))) || '|' ||
    upper(regexp_replace(NEW."account_number", '[^A-Za-z0-9]', '', 'g')), 'sha256'
  ), 'hex');
  INSERT INTO "payout_destination_owners" ("destination_hash", "identity_hash", "first_registered_by")
  VALUES (destination_hash_value, owner_identity_hash, NEW."user_id")
  ON CONFLICT ("destination_hash") DO UPDATE SET "updated_at" = CURRENT_TIMESTAMP
  WHERE "payout_destination_owners"."identity_hash" = EXCLUDED."identity_hash";
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 1 THEN
    RAISE EXCEPTION 'This payout destination is permanently registered to another verified person.' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "enforce_reseller_payout_destination_owner_trigger"
BEFORE INSERT OR UPDATE OF "user_id", "type", "bank_name", "account_number" ON "payment_methods"
FOR EACH ROW EXECUTE FUNCTION "enforce_reseller_payout_destination_owner"();

REVOKE ALL ON FUNCTION "enforce_reseller_payout_destination_owner"() FROM PUBLIC;

COMMIT;
