CREATE TABLE IF NOT EXISTS "branch_cash_deposits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reference_number" VARCHAR NOT NULL,
  "branch_id" TEXT NOT NULL,
  "period_start" TIMESTAMPTZ(6) NOT NULL,
  "period_end" TIMESTAMPTZ(6) NOT NULL,
  "expected_cash_snapshot" DECIMAL(12,2) NOT NULL,
  "deposit_amount" DECIMAL(12,2) NOT NULL,
  "variance_amount" DECIMAL(12,2) NOT NULL,
  "bank_name" VARCHAR NOT NULL,
  "bank_account_last_four" VARCHAR(4),
  "bank_reference" VARCHAR NOT NULL,
  "deposited_at" TIMESTAMPTZ(6) NOT NULL,
  "proof_url" VARCHAR,
  "notes" TEXT,
  "status" VARCHAR NOT NULL DEFAULT 'submitted',
  "submitted_by" TEXT NOT NULL,
  "submitted_by_name_snapshot" VARCHAR NOT NULL,
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_by" TEXT,
  "confirmed_by_name_snapshot" VARCHAR,
  "confirmed_at" TIMESTAMPTZ(6),
  "reviewed_by" TEXT,
  "reviewed_by_name_snapshot" VARCHAR,
  "reviewed_at" TIMESTAMPTZ(6),
  "review_notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_cash_deposits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "branch_cash_deposits_reference_number_key" ON "branch_cash_deposits"("reference_number");
CREATE UNIQUE INDEX IF NOT EXISTS "branch_cash_deposits_bank_reference_key" ON "branch_cash_deposits"("bank_reference");
CREATE INDEX IF NOT EXISTS "branch_cash_deposits_branch_id_period_start_period_end_idx" ON "branch_cash_deposits"("branch_id", "period_start", "period_end");
CREATE INDEX IF NOT EXISTS "branch_cash_deposits_branch_id_status_deposited_at_idx" ON "branch_cash_deposits"("branch_id", "status", "deposited_at");
