ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "password_is_temporary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "password_retention_stage" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "password_prompt_due_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "password_changed_at" TIMESTAMP(3);

COMMENT ON COLUMN "users"."password_is_temporary" IS 'True while the reseller still uses the system-generated registration password.';
COMMENT ON COLUMN "users"."password_retention_stage" IS 'Completed temporary-password retention checkpoint count.';
COMMENT ON COLUMN "users"."password_prompt_due_at" IS 'Next Manila-calendar date when password review is required.';
COMMENT ON COLUMN "users"."password_changed_at" IS 'Most recent successful password change timestamp.';
