ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "login_disabled" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "users"."login_disabled" IS 'Blocks interactive authentication without deactivating system, ledger, tree, or financial functions.';
