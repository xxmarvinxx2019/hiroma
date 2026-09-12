BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "users"
  ADD COLUMN "first_name" TEXT,
  ADD COLUMN "middle_name" TEXT,
  ADD COLUMN "last_name" TEXT,
  ADD COLUMN "name_suffix" TEXT;

CREATE INDEX IF NOT EXISTS "users_reseller_created_at_id_idx"
  ON "users" ("created_at" DESC, "id")
  WHERE "role" = 'reseller'::"Role";

CREATE INDEX IF NOT EXISTS "users_reseller_status_created_at_id_idx"
  ON "users" ("status", "created_at" DESC, "id")
  WHERE "role" = 'reseller'::"Role";

CREATE INDEX IF NOT EXISTS "users_reseller_last_name_first_name_id_idx"
  ON "users" ("last_name", "first_name", "id")
  WHERE "role" = 'reseller'::"Role" AND "last_name" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "users_reseller_full_name_trgm_idx"
  ON "users" USING GIN (lower("full_name") gin_trgm_ops)
  WHERE "role" = 'reseller'::"Role";

CREATE INDEX IF NOT EXISTS "users_reseller_username_trgm_idx"
  ON "users" USING GIN (lower("username") gin_trgm_ops)
  WHERE "role" = 'reseller'::"Role";

CREATE INDEX IF NOT EXISTS "users_reseller_mobile_trgm_idx"
  ON "users" USING GIN ("mobile" gin_trgm_ops)
  WHERE "role" = 'reseller'::"Role";

COMMIT;
