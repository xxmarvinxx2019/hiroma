-- Preserve the recipient's package economics on each binary pair event so
-- later upgrades or package edits cannot rewrite historical audit breakdowns.
ALTER TABLE "binary_pair_events"
  ADD COLUMN IF NOT EXISTS "recipient_package_id" TEXT,
  ADD COLUMN IF NOT EXISTS "package_name_snapshot" VARCHAR NOT NULL DEFAULT 'Unknown',
  ADD COLUMN IF NOT EXISTS "pair_value_snapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "package_snapshot_source" VARCHAR NOT NULL DEFAULT 'exact_event';

-- A failed first attempt may have left this new, unpopulated column as UUID.
-- Normalize it before backfilling from the existing text package primary key.
ALTER TABLE "binary_pair_events"
  ALTER COLUMN "recipient_package_id" TYPE TEXT
  USING "recipient_package_id"::text;

UPDATE "binary_pair_events" e
SET
  "recipient_package_id" = r."package_id",
  "package_name_snapshot" = COALESCE(p."name", 'Unknown'),
  "pair_value_snapshot" = e."points_per_pair" * e."peso_per_point",
  "package_snapshot_source" = 'reconstructed_current_package'
FROM "reseller_profiles" r
LEFT JOIN "packages" p ON p."id" = r."package_id"
WHERE r."user_id" = e."recipient_user_id"
  AND e."recipient_package_id" IS NULL;

CREATE INDEX IF NOT EXISTS "binary_pair_events_package_created_idx"
  ON "binary_pair_events"("recipient_package_id", "created_at");
