ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "two_factor_pin_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "two_factor_failed_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "two_factor_locked_until" TIMESTAMP(3);
