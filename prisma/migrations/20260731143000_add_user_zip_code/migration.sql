ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "zip_code" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_zip_code_format_check'
  ) THEN
    ALTER TABLE "users"
    ADD CONSTRAINT "users_zip_code_format_check"
    CHECK ("zip_code" IS NULL OR "zip_code" ~ '^[0-9]{4}$');
  END IF;
END $$;
