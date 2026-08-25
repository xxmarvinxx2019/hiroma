CREATE TABLE IF NOT EXISTS "inventory_audit_sessions" (
  "id" UUID NOT NULL,
  "reference_number" VARCHAR NOT NULL,
  "owner_id" TEXT NOT NULL,
  "status" VARCHAR NOT NULL DEFAULT 'counting',
  "scope" VARCHAR NOT NULL DEFAULT 'full',
  "started_by" TEXT NOT NULL,
  "started_by_name_snapshot" VARCHAR NOT NULL,
  "notes" TEXT,
  "submitted_at" TIMESTAMPTZ(6),
  "approved_at" TIMESTAMPTZ(6),
  "approved_by" TEXT,
  "approval_notes" TEXT,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_audit_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_audit_sessions_reference_number_key"
  ON "inventory_audit_sessions" ("reference_number");
CREATE INDEX IF NOT EXISTS "inventory_audit_sessions_owner_id_status_started_at_idx"
  ON "inventory_audit_sessions" ("owner_id", "status", "started_at" DESC);

CREATE TABLE IF NOT EXISTS "inventory_audit_items" (
  "id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "inventory_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "product_name_snapshot" VARCHAR NOT NULL,
  "expected_quantity" INTEGER NOT NULL,
  "counted_quantity" INTEGER,
  "variance_quantity" INTEGER,
  "unit_cost_snapshot" DECIMAL(12,2) NOT NULL,
  "variance_value" DECIMAL(12,2),
  "damaged_quantity" INTEGER NOT NULL DEFAULT 0,
  "expired_quantity" INTEGER NOT NULL DEFAULT 0,
  "missing_quantity" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "counted_by" TEXT,
  "counted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_audit_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_audit_items_session_id_fkey" FOREIGN KEY ("session_id")
    REFERENCES "inventory_audit_sessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_audit_items_session_id_product_id_key"
  ON "inventory_audit_items" ("session_id", "product_id");
CREATE INDEX IF NOT EXISTS "inventory_audit_items_session_id_variance_quantity_idx"
  ON "inventory_audit_items" ("session_id", "variance_quantity");
CREATE INDEX IF NOT EXISTS "inventory_audit_items_product_id_created_at_idx"
  ON "inventory_audit_items" ("product_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "inventory_audit_events" (
  "id" UUID NOT NULL,
  "owner_id" TEXT NOT NULL,
  "product_id" TEXT,
  "actor_id" TEXT,
  "actor_name_snapshot" VARCHAR NOT NULL,
  "event_type" VARCHAR NOT NULL,
  "quantity_delta" INTEGER NOT NULL DEFAULT 0,
  "quantity_before" INTEGER,
  "quantity_after" INTEGER,
  "unit_cost_snapshot" DECIMAL(12,2),
  "total_value" DECIMAL(12,2),
  "reference_type" VARCHAR,
  "reference_id" TEXT,
  "reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inventory_audit_events_owner_id_created_at_idx"
  ON "inventory_audit_events" ("owner_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "inventory_audit_events_owner_id_event_type_created_at_idx"
  ON "inventory_audit_events" ("owner_id", "event_type", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "inventory_audit_events_product_id_created_at_idx"
  ON "inventory_audit_events" ("product_id", "created_at" DESC);

CREATE OR REPLACE FUNCTION prevent_inventory_audit_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'inventory_audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventory_audit_events_no_update ON "inventory_audit_events";
CREATE TRIGGER inventory_audit_events_no_update
  BEFORE UPDATE ON "inventory_audit_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_inventory_audit_event_mutation();

DROP TRIGGER IF EXISTS inventory_audit_events_no_delete ON "inventory_audit_events";
CREATE TRIGGER inventory_audit_events_no_delete
  BEFORE DELETE ON "inventory_audit_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_inventory_audit_event_mutation();
