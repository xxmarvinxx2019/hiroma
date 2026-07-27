ALTER TABLE "packages"
  ADD COLUMN IF NOT EXISTS "direct_referral_cap_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "daily_referral_cap" INTEGER NOT NULL DEFAULT 10;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'packages_daily_referral_cap_positive'
  ) THEN
    ALTER TABLE "packages"
      ADD CONSTRAINT "packages_daily_referral_cap_positive"
      CHECK ("daily_referral_cap" > 0);
  END IF;
END
$$;
