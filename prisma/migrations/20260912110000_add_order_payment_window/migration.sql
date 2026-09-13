ALTER TABLE "distributor_profiles"
ADD COLUMN "accepts_cash_on_pickup" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "payment_methods"
ADD COLUMN "is_enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "orders"
ADD COLUMN "payment_method_id" UUID,
ADD COLUMN "payment_due_at" TIMESTAMPTZ(6),
ADD COLUMN "payment_destination_snapshot" JSONB;

CREATE INDEX "orders_payment_expiry_idx"
ON "orders"("payment_due_at", "payment_status", "status");

CREATE TABLE "order_payment_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" TEXT NOT NULL,
  "submitted_by" UUID NOT NULL,
  "sender_name" VARCHAR(160) NOT NULL,
  "reference_number" VARCHAR(160) NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "paid_at" TIMESTAMPTZ(6) NOT NULL,
  "proof_path" TEXT NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'submitted',
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMPTZ(6),
  "rejection_reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_payment_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_payment_evidence_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE
);

CREATE INDEX "order_payment_evidence_order_id_created_at_idx"
ON "order_payment_evidence"("order_id", "created_at");

CREATE UNIQUE INDEX "order_payment_evidence_order_id_reference_number_key"
ON "order_payment_evidence"("order_id", "reference_number");
