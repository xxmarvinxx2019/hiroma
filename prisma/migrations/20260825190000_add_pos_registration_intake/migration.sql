CREATE TYPE "PosRegistrationIntakeStatus" AS ENUM (
  'draft_intake',
  'pending_payment_verification',
  'payment_verified_ready_for_release',
  'released_pending_encoding',
  'encoding_in_progress',
  'registration_completed',
  'needs_correction',
  'payment_rejected',
  'cancelled_refund_required'
);

CREATE TABLE "pos_registration_intakes" (
  "id" UUID NOT NULL,
  "client_intake_id" UUID NOT NULL,
  "receipt_number" VARCHAR(80) NOT NULL,
  "owner_id" TEXT NOT NULL,
  "terminal_id" UUID NOT NULL,
  "shift_id" UUID NOT NULL,
  "cashier_id" TEXT NOT NULL,
  "package_id" TEXT NOT NULL,
  "payment_method_id" TEXT,
  "pin_id" TEXT,
  "status" "PosRegistrationIntakeStatus" NOT NULL DEFAULT 'draft_intake',
  "applicant_full_name" VARCHAR(180) NOT NULL,
  "applicant_mobile" VARCHAR(40) NOT NULL,
  "applicant_email" VARCHAR(180),
  "applicant_birthday" DATE NOT NULL,
  "applicant_birthplace" VARCHAR(240) NOT NULL,
  "applicant_address" JSONB NOT NULL,
  "identity_document_type" VARCHAR(80),
  "identity_document_reference" VARCHAR(180),
  "referrer_username" VARCHAR(120) NOT NULL,
  "preferred_position" VARCHAR(10),
  "applicant_snapshot" JSONB NOT NULL,
  "payment_method_snapshot" VARCHAR(160) NOT NULL,
  "payment_reference" VARCHAR(160),
  "payment_proof_url" TEXT,
  "amount_snapshot" DECIMAL(12,2) NOT NULL,
  "captured_offline" BOOLEAN NOT NULL DEFAULT false,
  "payment_verified_at" TIMESTAMPTZ(6),
  "approver_id" TEXT,
  "released_at" TIMESTAMPTZ(6),
  "released_by_id" TEXT,
  "encoding_started_at" TIMESTAMPTZ(6),
  "encoder_id" TEXT,
  "completed_at" TIMESTAMPTZ(6),
  "completed_user_id" TEXT,
  "exception_reason" VARCHAR(500),
  "notes" VARCHAR(1000),
  "local_created_at" TIMESTAMPTZ(6) NOT NULL,
  "server_received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "pos_registration_intakes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_registration_events" (
  "id" UUID NOT NULL,
  "intake_id" UUID NOT NULL,
  "actor_id" TEXT NOT NULL,
  "from_status" "PosRegistrationIntakeStatus",
  "to_status" "PosRegistrationIntakeStatus" NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "reason" VARCHAR(500),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_registration_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pos_registration_intakes_client_intake_id_key" ON "pos_registration_intakes"("client_intake_id");
CREATE UNIQUE INDEX "pos_registration_intakes_receipt_number_key" ON "pos_registration_intakes"("receipt_number");
CREATE UNIQUE INDEX "pos_registration_intakes_pin_id_key" ON "pos_registration_intakes"("pin_id");
CREATE UNIQUE INDEX "pos_registration_intakes_completed_user_id_key" ON "pos_registration_intakes"("completed_user_id");
CREATE UNIQUE INDEX "pos_registration_intakes_payment_method_id_payment_reference_key" ON "pos_registration_intakes"("payment_method_id", "payment_reference");
CREATE INDEX "pos_registration_intakes_owner_id_status_created_at_idx" ON "pos_registration_intakes"("owner_id", "status", "created_at");
CREATE INDEX "pos_registration_intakes_cashier_id_shift_id_idx" ON "pos_registration_intakes"("cashier_id", "shift_id");
CREATE INDEX "pos_registration_intakes_terminal_id_created_at_idx" ON "pos_registration_intakes"("terminal_id", "created_at");
CREATE INDEX "pos_registration_events_intake_id_created_at_idx" ON "pos_registration_events"("intake_id", "created_at");
CREATE INDEX "pos_registration_events_actor_id_created_at_idx" ON "pos_registration_events"("actor_id", "created_at");

ALTER TABLE "pos_registration_intakes" ADD CONSTRAINT "pos_registration_intakes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_registration_intakes" ADD CONSTRAINT "pos_registration_intakes_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "pos_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_registration_intakes" ADD CONSTRAINT "pos_registration_intakes_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "pos_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_registration_intakes" ADD CONSTRAINT "pos_registration_intakes_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_registration_intakes" ADD CONSTRAINT "pos_registration_intakes_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_registration_intakes" ADD CONSTRAINT "pos_registration_intakes_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_registration_intakes" ADD CONSTRAINT "pos_registration_intakes_encoder_id_fkey" FOREIGN KEY ("encoder_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_registration_intakes" ADD CONSTRAINT "pos_registration_intakes_completed_user_id_fkey" FOREIGN KEY ("completed_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_registration_intakes" ADD CONSTRAINT "pos_registration_intakes_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_registration_intakes" ADD CONSTRAINT "pos_registration_intakes_pin_id_fkey" FOREIGN KEY ("pin_id") REFERENCES "pins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_registration_events" ADD CONSTRAINT "pos_registration_events_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "pos_registration_intakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_registration_events" ADD CONSTRAINT "pos_registration_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
