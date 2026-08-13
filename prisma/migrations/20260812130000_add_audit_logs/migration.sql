CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id" TEXT,
  "user_name" TEXT,
  "user_role" TEXT,
  "member_id" TEXT,
  "activity_type" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "ip_address" TEXT,
  "device" TEXT,
  "risk_level" TEXT NOT NULL DEFAULT 'low',
  "status" TEXT NOT NULL DEFAULT 'normal',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_created_at_idx"
ON "audit_logs"("created_at");

CREATE INDEX "audit_logs_user_id_created_at_idx"
ON "audit_logs"("user_id", "created_at");

CREATE INDEX "audit_logs_user_role_created_at_idx"
ON "audit_logs"("user_role", "created_at");

CREATE INDEX "audit_logs_activity_type_created_at_idx"
ON "audit_logs"("activity_type", "created_at");

CREATE INDEX "audit_logs_category_created_at_idx"
ON "audit_logs"("category", "created_at");

CREATE INDEX "audit_logs_risk_level_created_at_idx"
ON "audit_logs"("risk_level", "created_at");

CREATE INDEX "audit_logs_status_created_at_idx"
ON "audit_logs"("status", "created_at");
