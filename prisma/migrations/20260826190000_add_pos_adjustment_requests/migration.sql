CREATE TABLE "pos_adjustment_requests" (
  "id" UUID NOT NULL,
  "owner_id" TEXT NOT NULL,
  "pos_transaction_id" UUID NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "reviewed_by_id" TEXT,
  "request_type" VARCHAR(20) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "reason" VARCHAR(500) NOT NULL,
  "review_notes" VARCHAR(500),
  "amount_snapshot" DECIMAL(12,2) NOT NULL,
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "pos_adjustment_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_adjustment_requests_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pos_adjustment_requests_pos_transaction_id_fkey" FOREIGN KEY ("pos_transaction_id") REFERENCES "pos_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pos_adjustment_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pos_adjustment_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "pos_adjustment_requests_pos_transaction_id_key" ON "pos_adjustment_requests"("pos_transaction_id");
CREATE INDEX "pos_adjustment_requests_owner_id_status_requested_at_idx" ON "pos_adjustment_requests"("owner_id", "status", "requested_at");

ALTER TYPE "PosTransactionStatus" ADD VALUE IF NOT EXISTS 'voided';
ALTER TYPE "PosTransactionStatus" ADD VALUE IF NOT EXISTS 'refunded';
