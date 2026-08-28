BEGIN;

DROP INDEX IF EXISTS "pos_adjustment_requests_pos_transaction_id_key";

CREATE INDEX "pos_adjustment_requests_pos_transaction_id_status_idx"
ON "pos_adjustment_requests"("pos_transaction_id", "status");

CREATE TABLE "pos_adjustment_items" (
  "id" UUID NOT NULL,
  "adjustment_request_id" UUID NOT NULL,
  "pos_transaction_item_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "disposition" VARCHAR(30) NOT NULL,
  "unit_price_snapshot" DECIMAL(12,2) NOT NULL,
  "subtotal_snapshot" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "pos_adjustment_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_adjustment_items_request_fkey" FOREIGN KEY ("adjustment_request_id") REFERENCES "pos_adjustment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pos_adjustment_items_transaction_item_fkey" FOREIGN KEY ("pos_transaction_item_id") REFERENCES "pos_transaction_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pos_adjustment_items_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "pos_adjustment_items_disposition_valid" CHECK ("disposition" IN ('resellable', 'damaged', 'expired'))
);

CREATE UNIQUE INDEX "pos_adjustment_items_request_item_key"
ON "pos_adjustment_items"("adjustment_request_id", "pos_transaction_item_id");

CREATE INDEX "pos_adjustment_items_transaction_item_id_idx"
ON "pos_adjustment_items"("pos_transaction_item_id");

COMMIT;
