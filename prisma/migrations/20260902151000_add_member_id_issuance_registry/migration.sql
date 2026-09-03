BEGIN;

LOCK TABLE "audit_logs", "member_id_sequences", "users" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "member_id_issuances" (
  "member_id" TEXT NOT NULL,
  "year" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "evidence_source" VARCHAR(32) NOT NULL,
  "evidence_subject_id" TEXT,
  "allocated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "member_id_issuances_pkey" PRIMARY KEY ("member_id"),
  CONSTRAINT "member_id_issuances_year_sequence_key" UNIQUE ("year", "sequence"),
  CONSTRAINT "member_id_issuances_format_check" CHECK (
    "member_id" = 'HRM-' || "year" || '-' || lpad("sequence"::TEXT, 6, '0')
    AND "year" ~ '^[0-9]{4}$'
    AND "sequence" > 0
  ),
  CONSTRAINT "member_id_issuances_source_check" CHECK (
    "evidence_source" IN (
      'runtime_allocation',
      'current_user_backfill',
      'audit_log_backfill',
      'operator_reconciled'
    )
  )
);

CREATE INDEX "member_id_issuances_allocated_at_idx"
  ON "member_id_issuances"("allocated_at");

-- A recycled ID is already ambiguous and cannot be silently assigned to one
-- owner. Stop so an operator can retire/reissue the collision explicitly.
DO $$
DECLARE
  collisions TEXT;
BEGIN
  WITH evidence AS (
    SELECT "member_id", "id" AS subject_id
    FROM "users"
    WHERE "member_id" ~ '^HRM-[0-9]{4}-[0-9]{6}$'
    UNION ALL
    SELECT "member_id", "user_id" AS subject_id
    FROM "audit_logs"
    WHERE "member_id" ~ '^HRM-[0-9]{4}-[0-9]{6}$'
      AND "user_id" IS NOT NULL
  )
  SELECT string_agg(conflict."member_id", ', ' ORDER BY conflict."member_id")
  INTO collisions
  FROM (
    SELECT "member_id"
    FROM evidence
    GROUP BY "member_id"
    HAVING COUNT(DISTINCT subject_id) > 1
    ORDER BY "member_id"
    LIMIT 25
  ) conflict;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION
      'Member IDs already associated with multiple accounts require reconciliation: %',
      collisions
      USING ERRCODE = '23505';
  END IF;
END $$;

WITH evidence AS (
  SELECT "member_id", "id" AS subject_id, "created_at"::TIMESTAMPTZ AS seen_at,
         'current_user_backfill'::TEXT AS evidence_source, 1 AS priority
  FROM "users"
  WHERE "member_id" ~ '^HRM-[0-9]{4}-[0-9]{6}$'
  UNION ALL
  SELECT "member_id", "user_id" AS subject_id, "created_at" AS seen_at,
         'audit_log_backfill'::TEXT AS evidence_source, 2 AS priority
  FROM "audit_logs"
  WHERE "member_id" ~ '^HRM-[0-9]{4}-[0-9]{6}$'
), canonical AS (
  SELECT DISTINCT ON ("member_id")
         "member_id", subject_id, seen_at, evidence_source
  FROM evidence
  ORDER BY "member_id", priority, seen_at
)
INSERT INTO "member_id_issuances" (
  "member_id", "year", "sequence", "evidence_source",
  "evidence_subject_id", "allocated_at"
)
SELECT "member_id",
       split_part("member_id", '-', 2),
       split_part("member_id", '-', 3)::INTEGER,
       evidence_source,
       subject_id,
       COALESCE(seen_at, transaction_timestamp())
FROM canonical;

INSERT INTO "member_id_sequences" ("year", "last_sequence")
SELECT "year", MAX("sequence")
FROM "member_id_issuances"
GROUP BY "year"
ON CONFLICT ("year") DO UPDATE
SET "last_sequence" = GREATEST(
  "member_id_sequences"."last_sequence",
  EXCLUDED."last_sequence"
);

CREATE OR REPLACE FUNCTION "validate_member_id_issuance_insert"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."allocated_at" := transaction_timestamp();
  IF NEW."member_id" <> ('HRM-' || NEW."year" || '-' || lpad(NEW."sequence"::TEXT, 6, '0'))
     OR NEW."year" !~ '^[0-9]{4}$'
     OR NEW."sequence" <= 0 THEN
    RAISE EXCEPTION 'Member ID issuance format and sequence do not match.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO "member_id_sequences" ("year", "last_sequence")
  VALUES (NEW."year", NEW."sequence")
  ON CONFLICT ("year") DO UPDATE
  SET "last_sequence" = GREATEST(
    "member_id_sequences"."last_sequence",
    EXCLUDED."last_sequence"
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "member_id_issuances_validate_insert"
BEFORE INSERT ON "member_id_issuances"
FOR EACH ROW EXECUTE FUNCTION "validate_member_id_issuance_insert"();

CREATE OR REPLACE FUNCTION "reject_member_id_issuance_change"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Member ID issuance history is append-only.' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "member_id_issuances_append_only"
BEFORE UPDATE OR DELETE ON "member_id_issuances"
FOR EACH ROW EXECUTE FUNCTION "reject_member_id_issuance_change"();

CREATE OR REPLACE FUNCTION "validate_user_member_id"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."member_id" IS DISTINCT FROM NEW."member_id" THEN
    RAISE EXCEPTION 'A user Member ID is permanent and cannot be changed.' USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "member_id_issuances" issuance
    WHERE issuance."member_id" = NEW."member_id"
  ) THEN
    RAISE EXCEPTION 'User Member ID has no permanent issuance record.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_require_member_id_issuance"
BEFORE INSERT OR UPDATE OF "member_id" ON "users"
FOR EACH ROW EXECUTE FUNCTION "validate_user_member_id"();

COMMIT;
