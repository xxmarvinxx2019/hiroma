ALTER TABLE "pos_transactions"
ADD COLUMN "receipt_number" VARCHAR(80);

UPDATE "pos_transactions"
SET "receipt_number" = 'HRM-LEGACY-' || UPPER(REPLACE("client_transaction_id"::text, '-', ''))
WHERE "receipt_number" IS NULL;

ALTER TABLE "pos_transactions"
ALTER COLUMN "receipt_number" SET NOT NULL;

CREATE UNIQUE INDEX "pos_transactions_receipt_number_key"
ON "pos_transactions"("receipt_number");
