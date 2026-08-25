ALTER TABLE "pos_transactions"
ADD COLUMN "payment_method_id" TEXT,
ADD COLUMN "reviewed_by_id" TEXT,
ADD COLUMN "reviewed_at" TIMESTAMPTZ(6),
ADD COLUMN "review_notes" VARCHAR(500);

CREATE INDEX "pos_transactions_owner_id_status_reviewed_at_idx"
ON "pos_transactions"("owner_id", "status", "reviewed_at");

CREATE UNIQUE INDEX "pos_transactions_payment_method_id_payment_reference_key"
ON "pos_transactions"("payment_method_id", "payment_reference");

ALTER TABLE "pos_transactions"
ADD CONSTRAINT "pos_transactions_reviewed_by_id_fkey"
FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pos_transactions"
ADD CONSTRAINT "pos_transactions_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
