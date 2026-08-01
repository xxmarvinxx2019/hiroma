ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "password_change_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "temporary_password_retained_at" TIMESTAMP(3);

COMMENT ON COLUMN "users"."password_change_required" IS 'Prompts a reseller to change or explicitly retain the temporary password after first login.';
COMMENT ON COLUMN "users"."temporary_password_retained_at" IS 'Records when the reseller explicitly chose to retain the temporary password.';
