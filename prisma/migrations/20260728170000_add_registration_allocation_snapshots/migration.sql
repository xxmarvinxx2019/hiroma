-- Freeze the compensation configuration used by every registration so reports
-- remain correct even when packages, bonuses, or point rates are changed later.
ALTER TABLE "registration_financials"
  ADD COLUMN IF NOT EXISTS "package_name_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "direct_referral_allocation" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "binary_commission_allocation" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "binary_points_per_pair" INTEGER,
  ADD COLUMN IF NOT EXISTS "binary_point_peso_rate" DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS "registration_channel" VARCHAR NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS "allocation_snapshot_source" VARCHAR NOT NULL DEFAULT 'estimated_legacy';

-- Legacy registrations cannot recover a historical package version. Populate
-- them from the present package configuration and make that limitation visible
-- in reporting through allocation_snapshot_source.
UPDATE "registration_financials" AS rf
SET
  "package_name_snapshot" = p."name",
  "direct_referral_allocation" = p."direct_referral_bonus",
  "binary_points_per_pair" = ROUND(p."pairing_bonus_value")::int,
  "binary_point_peso_rate" = 0.5000,
  "binary_commission_allocation" = ROUND(p."pairing_bonus_value" * 0.5000, 2),
  "registration_channel" = CASE WHEN u."role" = 'admin' THEN 'admin_direct' ELSE 'city' END,
  "allocation_snapshot_source" = 'estimated_legacy'
FROM "packages" AS p, "users" AS u
WHERE p."id" = rf."package_id"
  AND u."id" = rf."city_dist_id"
  AND (
    rf."package_name_snapshot" IS NULL
    OR rf."direct_referral_allocation" IS NULL
    OR rf."binary_commission_allocation" IS NULL
    OR rf."binary_points_per_pair" IS NULL
    OR rf."binary_point_peso_rate" IS NULL
  );

ALTER TABLE "registration_financials"
  ALTER COLUMN "package_name_snapshot" SET NOT NULL,
  ALTER COLUMN "direct_referral_allocation" SET NOT NULL,
  ALTER COLUMN "binary_commission_allocation" SET NOT NULL,
  ALTER COLUMN "binary_points_per_pair" SET NOT NULL,
  ALTER COLUMN "binary_point_peso_rate" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "registration_financials_channel_created_at_idx"
ON "registration_financials" ("registration_channel", "created_at");
