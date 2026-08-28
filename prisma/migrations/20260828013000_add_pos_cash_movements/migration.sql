BEGIN;

CREATE TABLE "pos_cash_movements" (
  "id" UUID NOT NULL,
  "client_request_id" UUID NOT NULL,
  "owner_id" TEXT NOT NULL,
  "shift_id" UUID NOT NULL,
  "terminal_id" UUID NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "reviewed_by_id" TEXT,
  "movement_type" VARCHAR(20) NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "purpose" VARCHAR(80) NOT NULL,
  "notes" VARCHAR(500) NOT NULL,
  "reference" VARCHAR(160),
  "review_notes" VARCHAR(500),
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "pos_cash_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_cash_movements_type_check" CHECK ("movement_type" IN ('paid_in', 'paid_out')),
  CONSTRAINT "pos_cash_movements_status_check" CHECK ("status" IN ('applied', 'pending', 'approved', 'rejected')),
  CONSTRAINT "pos_cash_movements_amount_check" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "pos_cash_movements_client_request_id_key" ON "pos_cash_movements"("client_request_id");
CREATE INDEX "pos_cash_movements_shift_id_status_requested_at_idx" ON "pos_cash_movements"("shift_id", "status", "requested_at");
CREATE INDEX "pos_cash_movements_owner_id_status_idx" ON "pos_cash_movements"("owner_id", "status");
ALTER TABLE "pos_cash_movements" ADD CONSTRAINT "pos_cash_movements_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_cash_movements" ADD CONSTRAINT "pos_cash_movements_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "pos_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_cash_movements" ADD CONSTRAINT "pos_cash_movements_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "pos_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_cash_movements" ADD CONSTRAINT "pos_cash_movements_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_cash_movements" ADD CONSTRAINT "pos_cash_movements_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
