CREATE TABLE "pos_terminal_enrollments" (
  "id" UUID NOT NULL,
  "owner_id" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "terminal_name" VARCHAR(120) NOT NULL,
  "code_hash" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "enrolled_terminal_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_terminal_enrollments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_terminal_enrollments_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pos_terminal_enrollments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pos_terminal_enrollments_enrolled_terminal_id_fkey" FOREIGN KEY ("enrolled_terminal_id") REFERENCES "pos_terminals"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "pos_terminal_enrollments_code_hash_key" ON "pos_terminal_enrollments"("code_hash");
CREATE UNIQUE INDEX "pos_terminal_enrollments_enrolled_terminal_id_key" ON "pos_terminal_enrollments"("enrolled_terminal_id");
CREATE INDEX "pos_terminal_enrollments_owner_id_expires_at_idx" ON "pos_terminal_enrollments"("owner_id", "expires_at");
CREATE INDEX "pos_terminal_enrollments_created_by_id_created_at_idx" ON "pos_terminal_enrollments"("created_by_id", "created_at");

CREATE TABLE "pos_enrollment_rate_limits" (
  "bucket_key" VARCHAR(96) NOT NULL,
  "window_start" TIMESTAMPTZ(6) NOT NULL,
  "request_count" INTEGER NOT NULL DEFAULT 1,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "pos_enrollment_rate_limits_pkey" PRIMARY KEY ("bucket_key")
);
CREATE INDEX "pos_enrollment_rate_limits_expires_at_idx" ON "pos_enrollment_rate_limits"("expires_at");
