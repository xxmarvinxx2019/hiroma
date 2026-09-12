BEGIN;

ALTER TABLE "pin_requests"
  ADD COLUMN "payment_due_at" TIMESTAMPTZ(6),
  ADD COLUMN "payment_method_id" TEXT,
  ADD COLUMN "payment_destination_snapshot" JSONB;

UPDATE "pin_requests"
SET "payment_due_at" = "created_at" + INTERVAL '48 hours'
WHERE "status" = 'pending' AND "payment_due_at" IS NULL;

CREATE TABLE "pin_request_payment_evidence" (
  "id" TEXT PRIMARY KEY,
  "pin_request_id" TEXT NOT NULL,
  "payment_method_id" TEXT NOT NULL,
  "provider_snapshot" VARCHAR(40) NOT NULL,
  "account_name_snapshot" VARCHAR(160) NOT NULL,
  "account_number_snapshot" VARCHAR(160) NOT NULL,
  "bank_name_snapshot" VARCHAR(160),
  "sender_name" VARCHAR(160) NOT NULL,
  "reference_number" VARCHAR(160) NOT NULL,
  "paid_at" TIMESTAMPTZ(6) NOT NULL,
  "proof_path" VARCHAR(500) NOT NULL,
  "status" VARCHAR(40) NOT NULL DEFAULT 'submitted',
  "reviewed_by_actor_id" UUID,
  "reviewed_at" TIMESTAMPTZ(6),
  "review_notes" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pin_request_payment_evidence_pin_request_id_fkey"
    FOREIGN KEY ("pin_request_id") REFERENCES "pin_requests"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "pin_request_payment_evidence_method_reference_key"
  ON "pin_request_payment_evidence" ("payment_method_id", LOWER("reference_number"));
CREATE INDEX "pin_request_payment_evidence_request_created_idx"
  ON "pin_request_payment_evidence" ("pin_request_id", "created_at" DESC);
CREATE INDEX "pin_request_payment_evidence_status_created_idx"
  ON "pin_request_payment_evidence" ("status", "created_at");
CREATE INDEX "pin_requests_payment_due_idx"
  ON "pin_requests" ("payment_due_at")
  WHERE "status" = 'pending';

-- Replace the former one-step paid-request trigger with the booking-style
-- workflow. Historical rows remain valid; new requests start unpaid and must
-- point to a snapshotted Admin destination with an exact 48-hour deadline.
CREATE OR REPLACE FUNCTION "validate_new_pin_request_payment_evidence"()
RETURNS TRIGGER AS $$
DECLARE
  recipient RECORD;
BEGIN
  SELECT users."role"::text AS role, users."status"::text AS status,
         profiles."dist_level"::text AS level, profiles."is_active" AS profile_active
  INTO recipient
  FROM "users" users
  LEFT JOIN "distributor_profiles" profiles ON profiles."user_id" = users."id"
  WHERE users."id" = NEW."city_dist_id";

  IF recipient.role <> 'city'
     OR recipient.status <> 'active'
     OR recipient.level <> 'city'
     OR recipient.profile_active IS NOT TRUE
     OR NEW."payment_method" NOT IN ('gcash', 'bank_transfer')
     OR NULLIF(TRIM(NEW."payment_method_id"), '') IS NULL
     OR NEW."payment_destination_snapshot" IS NULL
     OR NEW."payment_status" <> 'awaiting_payment'
     OR NEW."payment_reference" IS NOT NULL
     OR NEW."payment_sender_name" IS NOT NULL
     OR NEW."payment_datetime" IS NOT NULL
     OR NEW."payment_due_at" IS NULL
     OR ABS(EXTRACT(EPOCH FROM (NEW."payment_due_at" - NEW."created_at")) - 172800) > 5 THEN
    RAISE EXCEPTION 'New City PIN requests require an approved payment destination and an exact 48-hour unpaid reservation.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "protect_pin_request_payment_evidence"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PIN request payment evidence is append-only.' USING ERRCODE = '55000';
  END IF;
  IF NEW."pin_request_id" IS DISTINCT FROM OLD."pin_request_id"
     OR NEW."payment_method_id" IS DISTINCT FROM OLD."payment_method_id"
     OR NEW."provider_snapshot" IS DISTINCT FROM OLD."provider_snapshot"
     OR NEW."account_name_snapshot" IS DISTINCT FROM OLD."account_name_snapshot"
     OR NEW."account_number_snapshot" IS DISTINCT FROM OLD."account_number_snapshot"
     OR NEW."bank_name_snapshot" IS DISTINCT FROM OLD."bank_name_snapshot"
     OR NEW."sender_name" IS DISTINCT FROM OLD."sender_name"
     OR NEW."reference_number" IS DISTINCT FROM OLD."reference_number"
     OR NEW."paid_at" IS DISTINCT FROM OLD."paid_at"
     OR NEW."proof_path" IS DISTINCT FROM OLD."proof_path"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Submitted PIN payment facts are immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" <> 'submitted' AND ROW(NEW."status", NEW."reviewed_by_actor_id", NEW."reviewed_at", NEW."review_notes")
     IS DISTINCT FROM ROW(OLD."status", OLD."reviewed_by_actor_id", OLD."reviewed_at", OLD."review_notes") THEN
    RAISE EXCEPTION 'Reviewed PIN payment evidence is immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'submitted' AND NEW."status" NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'Payment evidence may only be verified or rejected.' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'submitted' AND (NEW."reviewed_by_actor_id" IS NULL OR NEW."reviewed_at" IS NULL OR LENGTH(TRIM(COALESCE(NEW."review_notes", ''))) < 5) THEN
    RAISE EXCEPTION 'Payment evidence review requires an actor, time, and notes.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pin_request_payment_evidence_protect_update"
BEFORE UPDATE ON "pin_request_payment_evidence"
FOR EACH ROW EXECUTE FUNCTION "protect_pin_request_payment_evidence"();

CREATE TRIGGER "pin_request_payment_evidence_protect_delete"
BEFORE DELETE ON "pin_request_payment_evidence"
FOR EACH ROW EXECUTE FUNCTION "protect_pin_request_payment_evidence"();

COMMIT;
