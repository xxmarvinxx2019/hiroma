CREATE TYPE "PosShiftStatus" AS ENUM ('open', 'locally_closed', 'finalized', 'needs_review');
CREATE TYPE "PosTransactionType" AS ENUM ('member_sale', 'non_member_sale', 'new_reseller_registration');
CREATE TYPE "PosTransactionStatus" AS ENUM ('pending_sync', 'syncing', 'synced_pending_review', 'approved', 'needs_correction', 'rejected', 'finalized');

CREATE TABLE "pos_terminals" (
  "id" UUID NOT NULL,
  "owner_id" TEXT NOT NULL,
  "installation_id" VARCHAR(120) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "platform" VARCHAR(80),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "last_catalog_at" TIMESTAMPTZ(6),
  "last_inventory_at" TIMESTAMPTZ(6),
  "last_synced_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "pos_terminals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_shifts" (
  "id" UUID NOT NULL,
  "owner_id" TEXT NOT NULL,
  "terminal_id" UUID NOT NULL,
  "opened_by_id" TEXT NOT NULL,
  "closed_by_id" TEXT,
  "status" "PosShiftStatus" NOT NULL DEFAULT 'open',
  "opening_cash" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "expected_cash_snapshot" DECIMAL(12,2),
  "counted_cash" DECIMAL(12,2),
  "variance_snapshot" DECIMAL(12,2),
  "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "local_closed_at" TIMESTAMPTZ(6),
  "server_finalized_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "pos_shifts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_transactions" (
  "id" UUID NOT NULL,
  "client_transaction_id" UUID NOT NULL,
  "owner_id" TEXT NOT NULL,
  "terminal_id" UUID NOT NULL,
  "shift_id" UUID,
  "cashier_id" TEXT NOT NULL,
  "transaction_type" "PosTransactionType" NOT NULL,
  "status" "PosTransactionStatus" NOT NULL DEFAULT 'pending_sync',
  "member_id" TEXT,
  "customer_name_snapshot" TEXT,
  "payment_method_snapshot" VARCHAR(120) NOT NULL,
  "payment_reference" VARCHAR(160),
  "subtotal_snapshot" DECIMAL(12,2) NOT NULL,
  "discount_snapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_snapshot" DECIMAL(12,2) NOT NULL,
  "amount_received_snapshot" DECIMAL(12,2) NOT NULL,
  "change_snapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "order_id" TEXT,
  "registration_id" UUID,
  "registration_payload" JSONB,
  "notes" TEXT,
  "local_created_at" TIMESTAMPTZ(6) NOT NULL,
  "server_received_at" TIMESTAMPTZ(6),
  "finalized_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "pos_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_transaction_items" (
  "id" UUID NOT NULL,
  "pos_transaction_id" UUID NOT NULL,
  "product_id" TEXT NOT NULL,
  "product_name_snapshot" TEXT NOT NULL,
  "product_type_snapshot" VARCHAR(40) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_price_snapshot" DECIMAL(12,2) NOT NULL,
  "unit_cost_snapshot" DECIMAL(12,2) NOT NULL,
  "pu_value_snapshot" INTEGER NOT NULL DEFAULT 0,
  "subtotal_snapshot" DECIMAL(12,2) NOT NULL,
  "local_stock_before" INTEGER NOT NULL,
  "local_stock_after" INTEGER NOT NULL,
  CONSTRAINT "pos_transaction_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_inventory_allowances" (
  "id" UUID NOT NULL,
  "owner_id" TEXT NOT NULL,
  "terminal_id" UUID NOT NULL,
  "product_id" TEXT NOT NULL,
  "allocated_quantity" INTEGER NOT NULL,
  "consumed_quantity" INTEGER NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "pos_inventory_allowances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_sync_events" (
  "id" UUID NOT NULL,
  "terminal_id" UUID NOT NULL,
  "pos_transaction_id" UUID,
  "event_type" VARCHAR(80) NOT NULL,
  "outcome" VARCHAR(40) NOT NULL,
  "request_checksum" VARCHAR(128),
  "details" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_sync_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pos_terminals_installation_id_key" ON "pos_terminals"("installation_id");
CREATE UNIQUE INDEX "pos_terminals_owner_id_name_key" ON "pos_terminals"("owner_id", "name");
CREATE INDEX "pos_terminals_owner_id_is_active_idx" ON "pos_terminals"("owner_id", "is_active");
CREATE INDEX "pos_shifts_owner_id_status_idx" ON "pos_shifts"("owner_id", "status");
CREATE INDEX "pos_shifts_terminal_id_opened_at_idx" ON "pos_shifts"("terminal_id", "opened_at");
CREATE UNIQUE INDEX "pos_transactions_client_transaction_id_key" ON "pos_transactions"("client_transaction_id");
CREATE UNIQUE INDEX "pos_transactions_order_id_key" ON "pos_transactions"("order_id");
CREATE UNIQUE INDEX "pos_transactions_registration_id_key" ON "pos_transactions"("registration_id");
CREATE INDEX "pos_transactions_owner_id_status_local_created_at_idx" ON "pos_transactions"("owner_id", "status", "local_created_at");
CREATE INDEX "pos_transactions_terminal_id_status_idx" ON "pos_transactions"("terminal_id", "status");
CREATE INDEX "pos_transactions_shift_id_idx" ON "pos_transactions"("shift_id");
CREATE INDEX "pos_transaction_items_pos_transaction_id_idx" ON "pos_transaction_items"("pos_transaction_id");
CREATE INDEX "pos_transaction_items_product_id_idx" ON "pos_transaction_items"("product_id");
CREATE UNIQUE INDEX "pos_inventory_allowances_terminal_id_product_id_key" ON "pos_inventory_allowances"("terminal_id", "product_id");
CREATE INDEX "pos_inventory_allowances_owner_id_expires_at_idx" ON "pos_inventory_allowances"("owner_id", "expires_at");
CREATE INDEX "pos_sync_events_terminal_id_created_at_idx" ON "pos_sync_events"("terminal_id", "created_at");
CREATE INDEX "pos_sync_events_pos_transaction_id_created_at_idx" ON "pos_sync_events"("pos_transaction_id", "created_at");

ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "pos_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_transactions" ADD CONSTRAINT "pos_transactions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_transactions" ADD CONSTRAINT "pos_transactions_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "pos_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_transactions" ADD CONSTRAINT "pos_transactions_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "pos_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_transactions" ADD CONSTRAINT "pos_transactions_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_transactions" ADD CONSTRAINT "pos_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_transaction_items" ADD CONSTRAINT "pos_transaction_items_pos_transaction_id_fkey" FOREIGN KEY ("pos_transaction_id") REFERENCES "pos_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_transaction_items" ADD CONSTRAINT "pos_transaction_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_inventory_allowances" ADD CONSTRAINT "pos_inventory_allowances_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "pos_terminals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_inventory_allowances" ADD CONSTRAINT "pos_inventory_allowances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_sync_events" ADD CONSTRAINT "pos_sync_events_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "pos_terminals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_sync_events" ADD CONSTRAINT "pos_sync_events_pos_transaction_id_fkey" FOREIGN KEY ("pos_transaction_id") REFERENCES "pos_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
