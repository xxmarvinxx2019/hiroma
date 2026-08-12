CREATE TABLE "identity_account_limits" (
  "identity_hash" VARCHAR(64) PRIMARY KEY,
  "count" INTEGER NOT NULL DEFAULT 0,
  "max_allowed" INTEGER NOT NULL DEFAULT 7,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "identity_account_limit_range_check"
    CHECK ("count" >= 0 AND "max_allowed" > 0 AND "count" <= "max_allowed")
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE "role" = 'reseller'
      AND "status" <> 'inactive'
      AND "identity_document_hash" IS NOT NULL
    GROUP BY "identity_document_hash"
    HAVING COUNT(*) > 7
  ) THEN
    RAISE EXCEPTION 'An identity already exceeds the seven-account limit; reconcile it before enabling atomic limits.';
  END IF;
END $$;

INSERT INTO "identity_account_limits" ("identity_hash", "count", "max_allowed")
SELECT "identity_document_hash", COUNT(*)::INTEGER, 7
FROM "users"
WHERE "role" = 'reseller'
  AND "status" <> 'inactive'
  AND "identity_document_hash" IS NOT NULL
GROUP BY "identity_document_hash";
