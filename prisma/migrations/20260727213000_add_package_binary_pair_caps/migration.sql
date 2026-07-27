ALTER TABLE "packages"
ADD COLUMN IF NOT EXISTS "binary_pair_cap_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "daily_binary_pair_cap" INTEGER NOT NULL DEFAULT 10;

UPDATE "packages"
SET "daily_binary_pair_cap" = CASE
  WHEN LOWER("name") = 'starter' THEN 10
  WHEN LOWER("name") = 'silver' THEN 30
  WHEN LOWER("name") = 'gold' THEN 50
  ELSE COALESCE("daily_binary_pair_cap", 10)
END;

ALTER TABLE "packages"
DROP CONSTRAINT IF EXISTS "packages_daily_binary_pair_cap_check";

ALTER TABLE "packages"
ADD CONSTRAINT "packages_daily_binary_pair_cap_check"
CHECK ("daily_binary_pair_cap" >= 1);
