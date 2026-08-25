ALTER TABLE "pos_shifts"
  ADD COLUMN "closing_count_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "closing_explanation" VARCHAR(1000),
  ADD COLUMN "closing_submitted_at" TIMESTAMPTZ(6);

ALTER TABLE "inventory_audit_sessions"
  ADD COLUMN "pos_shift_id" UUID;

CREATE UNIQUE INDEX "inventory_audit_sessions_pos_shift_id_key"
  ON "inventory_audit_sessions"("pos_shift_id");

ALTER TABLE "inventory_audit_sessions"
  ADD CONSTRAINT "inventory_audit_sessions_pos_shift_id_fkey"
  FOREIGN KEY ("pos_shift_id") REFERENCES "pos_shifts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
