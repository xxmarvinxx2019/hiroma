ALTER TABLE "pos_terminals"
ADD COLUMN "receipt_code" VARCHAR(7),
ADD COLUMN "receipt_sequence_next" INTEGER NOT NULL DEFAULT 1;

UPDATE "pos_terminals"
SET "receipt_code" = UPPER(SUBSTRING(REPLACE("id"::text, '-', '') FROM 26 FOR 7));

ALTER TABLE "pos_terminals"
ALTER COLUMN "receipt_code" SET NOT NULL;

CREATE UNIQUE INDEX "pos_terminals_receipt_code_key" ON "pos_terminals"("receipt_code");

ALTER TABLE "pos_transactions"
ADD COLUMN "receipt_sequence" INTEGER;

CREATE UNIQUE INDEX "pos_transactions_terminal_id_receipt_sequence_key"
ON "pos_transactions"("terminal_id", "receipt_sequence");
