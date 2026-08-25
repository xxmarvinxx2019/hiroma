-- Groups the immutable inventory movement rows created by one internal
-- Admin-to-Branch transfer so the recipient can open one complete receipt.
ALTER TABLE "inventory_movements"
  ADD COLUMN IF NOT EXISTS "transfer_id" UUID,
  ADD COLUMN IF NOT EXISTS "accepted_quantity" INTEGER,
  ADD COLUMN IF NOT EXISTS "damaged_quantity" INTEGER,
  ADD COLUMN IF NOT EXISTS "missing_quantity" INTEGER,
  ADD COLUMN IF NOT EXISTS "receiving_notes" TEXT,
  ADD COLUMN IF NOT EXISTS "received_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "inventory_movements_transfer_id_idx"
  ON "inventory_movements" ("transfer_id");

CREATE TABLE IF NOT EXISTS "inventory_transfers" (
  "id" UUID NOT NULL,
  "reference_number" VARCHAR NOT NULL,
  "admin_id" TEXT NOT NULL,
  "recipient_id" TEXT NOT NULL,
  "status" VARCHAR NOT NULL DEFAULT 'in_transit',
  "reference_value" DECIMAL(12,2) NOT NULL,
  "notes" TEXT,
  "dispatched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "received_at" TIMESTAMPTZ(6),
  "received_by" TEXT,
  "receiving_notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_transfers_reference_number_key"
  ON "inventory_transfers" ("reference_number");
CREATE INDEX IF NOT EXISTS "inventory_transfers_recipient_id_status_created_at_idx"
  ON "inventory_transfers" ("recipient_id", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "inventory_transfers_admin_id_created_at_idx"
  ON "inventory_transfers" ("admin_id", "created_at" DESC);
