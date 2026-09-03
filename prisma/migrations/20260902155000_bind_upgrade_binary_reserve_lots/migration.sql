-- Every upgrade-funded Package Binary reserve lot must retain an authoritative
-- immutable link to the upgrade economics snapshot that funded it.
BEGIN;

DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'Hiroma financial migrations require PostgreSQL 15 or newer.';
  END IF;
END $$;

LOCK TABLE
  "binary_reserve_lots",
  "upgrade_financials"
IN SHARE ROW EXCLUSIVE MODE;

-- Refuse the cutover when historical upgrade lots cannot be tied back to an
-- authoritative upgrade. Never delete, rewrite, or fabricate this lineage.
DO $$
DECLARE
  unresolved_count BIGINT;
  unresolved_ids TEXT;
BEGIN
  WITH unresolved AS (
    SELECT lot."id"::TEXT AS "id"
    FROM "binary_reserve_lots" lot
    LEFT JOIN "upgrade_financials" upgrade
      ON upgrade."id" = lot."upgrade_financial_id"
    WHERE lot."upgrade_financial_id" IS NOT NULL
      AND upgrade."id" IS NULL
  ), ordered AS (
    SELECT "id", row_number() OVER (ORDER BY "id") AS row_number
    FROM unresolved
  )
  SELECT
    COUNT(*),
    string_agg("id", ', ' ORDER BY "id") FILTER (WHERE row_number <= 50)
  INTO unresolved_count, unresolved_ids
  FROM ordered;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Upgrade-funded binary reserve lots reference no authoritative upgrade.',
      DETAIL = format(
        'unresolved_reserve_lots=%s first_reserve_lot_ids=%s',
        unresolved_count,
        COALESCE(unresolved_ids, '(none)')
      ),
      HINT = 'Reconcile these lots from immutable upgrade records before retrying. Never delete or fabricate reserve lineage.';
  END IF;
END $$;

ALTER TABLE "binary_reserve_lots"
  ADD CONSTRAINT "binary_reserve_lots_upgrade_financial_id_fkey"
  FOREIGN KEY ("upgrade_financial_id")
  REFERENCES "upgrade_financials"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "binary_reserve_lots"
  VALIDATE CONSTRAINT "binary_reserve_lots_upgrade_financial_id_fkey";

COMMIT;
