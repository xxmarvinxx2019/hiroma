-- Make the immutable payout audit trail part of the payout state machine.
-- Status changes and their canonical audit row may be written in either order
-- inside one transaction, but both sides must agree exactly at COMMIT.

BEGIN;

DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'Hiroma financial migrations require PostgreSQL 15 or newer.';
  END IF;
END $$;

LOCK TABLE
  "audit_logs",
  "payouts"
IN SHARE ROW EXCLUSIVE MODE;

-- Canonical payout actions must always reference a real payout. Stop the
-- migration instead of silently deleting or rewriting historical evidence.
DO $$
DECLARE
  unresolved_count BIGINT;
  unresolved_ids TEXT;
BEGIN
  WITH unresolved AS (
    SELECT audit."id"
    FROM "audit_logs" audit
    LEFT JOIN "payouts" payout
      ON payout."id" = audit."metadata"->>'payout_id'
    WHERE audit."activity_type" = ANY (ARRAY[
      'payout_requested',
      'payout_approved',
      'payout_rejected',
      'payout_released'
    ]::TEXT[])
      AND payout."id" IS NULL
  ), ordered AS (
    SELECT "id", row_number() OVER (ORDER BY "id") AS row_number
    FROM unresolved
  )
  SELECT COUNT(*), string_agg("id", ', ' ORDER BY "id") FILTER (WHERE row_number <= 50)
  INTO unresolved_count, unresolved_ids
  FROM ordered;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Canonical payout audit rows reference no authoritative payout.',
      DETAIL = format(
        'unresolved_audit_rows=%s first_audit_ids=%s',
        unresolved_count,
        COALESCE(unresolved_ids, '(none)')
      ),
      HINT = 'Reconcile these rows from authoritative payout records before retrying. Never delete or fabricate financial audit evidence.';
  END IF;
END $$;

-- Existing payouts are admitted only when they already have one exact audit
-- chain for their current lifecycle state. The two metadata fields added by
-- this release (request/release reseller_id and release actor_type) are
-- optional only for pre-cutover rows; the reverse trigger below requires them
-- on every new audit row. Legacy stage timestamps predate database authorship,
-- so this cutover proves but does not rewrite them. Each transition after this
-- cutover must bind its fresh audit timestamp to its database-authored payout
-- timestamp at the column's stored precision.
DO $$
DECLARE
  unresolved_count BIGINT;
  unresolved_ids TEXT;
BEGIN
  WITH evidence AS (
    SELECT
      payout."id",
      payout."status",
      COUNT(audit."id") FILTER (
        WHERE audit."activity_type" = 'payout_requested'
      )::INTEGER AS request_count,
      COUNT(audit."id") FILTER (
        WHERE audit."activity_type" = 'payout_approved'
      )::INTEGER AS approval_count,
      COUNT(audit."id") FILTER (
        WHERE audit."activity_type" = 'payout_rejected'
      )::INTEGER AS rejection_count,
      COUNT(audit."id") FILTER (
        WHERE audit."activity_type" = 'payout_released'
      )::INTEGER AS release_count,
      COUNT(audit."id") FILTER (
        WHERE audit."id" IS NOT NULL
          AND (
            audit."category" IS DISTINCT FROM 'payout'
            OR audit."status" IS DISTINCT FROM 'completed'
            OR CASE
              WHEN jsonb_typeof(audit."metadata"->'amount') = 'number'
                THEN (audit."metadata"->>'amount')::NUMERIC IS DISTINCT FROM payout."amount"
              ELSE true
            END
            OR CASE audit."activity_type"
              WHEN 'payout_requested' THEN
                audit."user_id" IS DISTINCT FROM payout."user_id"
                OR audit."user_role" IS DISTINCT FROM 'reseller'
                OR audit."metadata"->>'payment_method' IS DISTINCT FROM payout."payment_method"
                OR (
                  audit."metadata" ? 'reseller_id'
                  AND audit."metadata"->>'reseller_id' IS DISTINCT FROM payout."user_id"
                )
              WHEN 'payout_approved' THEN
                audit."user_id" IS DISTINCT FROM payout."approved_by"
                OR audit."user_role" IS DISTINCT FROM 'admin'
                OR audit."metadata"->>'reseller_id' IS DISTINCT FROM payout."user_id"
                OR audit."metadata"->>'transaction_number' IS DISTINCT FROM payout."transaction_number"
              WHEN 'payout_rejected' THEN
                audit."user_id" IS DISTINCT FROM payout."approved_by"
                OR audit."user_role" IS DISTINCT FROM 'admin'
                OR audit."metadata"->>'reseller_id' IS DISTINCT FROM payout."user_id"
                OR audit."metadata"->>'notes' IS DISTINCT FROM payout."notes"
              WHEN 'payout_released' THEN
                audit."user_id" IS DISTINCT FROM payout."user_id"
                OR audit."user_role" IS DISTINCT FROM 'system'
                OR audit."metadata"->>'transaction_number' IS DISTINCT FROM payout."transaction_number"
                OR (
                  audit."metadata" ? 'reseller_id'
                  AND audit."metadata"->>'reseller_id' IS DISTINCT FROM payout."user_id"
                )
                OR (
                  audit."metadata" ? 'actor_type'
                  AND audit."metadata"->>'actor_type' IS DISTINCT FROM 'system'
                )
              ELSE true
            END
          )
      )::INTEGER AS invalid_count
    FROM "payouts" payout
    LEFT JOIN "audit_logs" audit
      ON audit."metadata"->>'payout_id' = payout."id"
     AND audit."activity_type" = ANY (ARRAY[
       'payout_requested',
       'payout_approved',
       'payout_rejected',
       'payout_released'
     ]::TEXT[])
    GROUP BY
      payout."id",
      payout."status",
      payout."user_id",
      payout."amount",
      payout."payment_method",
      payout."approved_by",
      payout."transaction_number",
      payout."notes"
  ), unresolved AS (
    SELECT "id"
    FROM evidence
    WHERE request_count <> 1
       OR invalid_count <> 0
       OR CASE "status"
         WHEN 'pending'::"PayoutStatus" THEN
           approval_count <> 0 OR rejection_count <> 0 OR release_count <> 0
         WHEN 'approved'::"PayoutStatus" THEN
           approval_count <> 1 OR rejection_count <> 0 OR release_count <> 0
         WHEN 'rejected'::"PayoutStatus" THEN
           approval_count <> 0 OR rejection_count <> 1 OR release_count <> 0
         WHEN 'released'::"PayoutStatus" THEN
           approval_count <> 1 OR rejection_count <> 0 OR release_count <> 1
         ELSE true
       END
  ), ordered AS (
    SELECT "id", row_number() OVER (ORDER BY "id") AS row_number
    FROM unresolved
  )
  SELECT COUNT(*), string_agg("id", ', ' ORDER BY "id") FILTER (WHERE row_number <= 50)
  INTO unresolved_count, unresolved_ids
  FROM ordered;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Existing payouts lack one exact canonical audit-evidence chain.',
      DETAIL = format(
        'unresolved_payouts=%s first_payout_ids=%s',
        unresolved_count,
        COALESCE(unresolved_ids, '(none)')
      ),
      HINT = 'Reconcile from immutable authoritative audit records before retrying. Never synthesize requested, approved, rejected, or released evidence from payout status alone.';
  END IF;
END $$;

CREATE UNIQUE INDEX "audit_logs_one_payout_lifecycle_action"
  ON "audit_logs" (("metadata"->>'payout_id'), "activity_type")
  WHERE "activity_type" = ANY (ARRAY[
    'payout_requested',
    'payout_approved',
    'payout_rejected',
    'payout_released'
  ]::TEXT[]);

-- The database, rather than an API host clock, authors every lifecycle time.
-- In particular, processed_at is the cutoff used by source-lot allocation, so
-- overwriting it before AFTER triggers run preserves deterministic FIFO.
CREATE OR REPLACE FUNCTION "enforce_payout_identity_and_status_transition"()
RETURNS TRIGGER AS $$
DECLARE
  approver_role TEXT;
  approver_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."requested_at" := (transaction_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3);

    IF NEW."status" <> 'pending'::"PayoutStatus" THEN
      RAISE EXCEPTION 'Payouts must be created in pending status.' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."amount" <= 0
       OR NEW."payment_method" IS NULL OR length(btrim(NEW."payment_method")) = 0
       OR NEW."cutoff_date" IS NULL OR NEW."payout_date" IS NULL THEN
      RAISE EXCEPTION 'A payout request requires a positive amount, payment method, cutoff, and release date.' USING ERRCODE = '23514';
    END IF;
    IF NEW."approved_by" IS NOT NULL OR NEW."processed_at" IS NOT NULL
       OR NEW."released_at" IS NOT NULL OR NEW."transaction_number" IS NOT NULL THEN
      RAISE EXCEPTION 'A pending payout cannot be pre-approved or pre-released.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'Payout identity is immutable after creation.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."user_id" IS DISTINCT FROM OLD."user_id" THEN
    RAISE EXCEPTION 'Payout recipient is immutable after creation.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."amount" IS DISTINCT FROM OLD."amount" THEN
    RAISE EXCEPTION 'Payout amount is immutable after creation.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."payment_method" IS DISTINCT FROM OLD."payment_method"
     OR NEW."payment_reference" IS DISTINCT FROM OLD."payment_reference"
     OR NEW."cutoff_date" IS DISTINCT FROM OLD."cutoff_date"
     OR NEW."payout_date" IS DISTINCT FROM OLD."payout_date"
     OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at" THEN
    RAISE EXCEPTION 'Payout destination and schedule are immutable after request.' USING ERRCODE = '55000';
  END IF;

  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    IF NEW."transaction_number" IS DISTINCT FROM OLD."transaction_number"
       OR NEW."approved_by" IS DISTINCT FROM OLD."approved_by"
       OR NEW."processed_at" IS DISTINCT FROM OLD."processed_at"
       OR NEW."released_at" IS DISTINCT FROM OLD."released_at"
       OR NEW."notes" IS DISTINCT FROM OLD."notes" THEN
      RAISE EXCEPTION 'Payout processing evidence may change only during a legal status transition.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'pending'::"PayoutStatus"
     AND NEW."status" IN ('approved'::"PayoutStatus", 'rejected'::"PayoutStatus") THEN
    NEW."processed_at" := (transaction_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3);

    IF NEW."approved_by" IS NULL OR NEW."released_at" IS NOT NULL THEN
      RAISE EXCEPTION 'Payout approval or rejection requires complete reviewer evidence.' USING ERRCODE = '23514';
    END IF;
    SELECT user_row."role"::text, user_row."status"::text
    INTO approver_role, approver_status
    FROM "public"."users" user_row
    WHERE user_row."id" = NEW."approved_by"
    FOR SHARE;
    IF approver_role <> 'admin' OR approver_status <> 'active' THEN
      RAISE EXCEPTION 'Payout reviewer must be an active administrator.' USING ERRCODE = '23514';
    END IF;
    IF NEW."status" = 'approved'::"PayoutStatus"
       AND (NEW."transaction_number" IS NULL OR length(btrim(NEW."transaction_number")) = 0) THEN
      RAISE EXCEPTION 'An approved payout requires an immutable transaction number.' USING ERRCODE = '23514';
    END IF;
    IF NEW."status" = 'rejected'::"PayoutStatus" AND NEW."transaction_number" IS NOT NULL THEN
      RAISE EXCEPTION 'A rejected payout cannot carry a release transaction number.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'approved'::"PayoutStatus"
     AND NEW."status" = 'released'::"PayoutStatus" THEN
    NEW."released_at" := transaction_timestamp();

    IF NEW."approved_by" IS DISTINCT FROM OLD."approved_by"
       OR NEW."processed_at" IS DISTINCT FROM OLD."processed_at"
       OR NEW."transaction_number" IS DISTINCT FROM OLD."transaction_number"
       OR NEW."notes" IS DISTINCT FROM OLD."notes" THEN
      RAISE EXCEPTION 'Payout release must preserve approval evidence and record its release time.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal payout status transition.' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "require_complete_payout_audit_evidence"()
RETURNS TRIGGER AS $$
DECLARE
  request_count INTEGER;
  approval_count INTEGER;
  rejection_count INTEGER;
  release_count INTEGER;
  invalid_count INTEGER;
  current_action TEXT;
  current_action_count INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;

  SELECT
    COUNT(audit."id") FILTER (
      WHERE audit."activity_type" = 'payout_requested'
    )::INTEGER,
    COUNT(audit."id") FILTER (
      WHERE audit."activity_type" = 'payout_approved'
    )::INTEGER,
    COUNT(audit."id") FILTER (
      WHERE audit."activity_type" = 'payout_rejected'
    )::INTEGER,
    COUNT(audit."id") FILTER (
      WHERE audit."activity_type" = 'payout_released'
    )::INTEGER,
    COUNT(audit."id") FILTER (
      WHERE audit."id" IS NOT NULL
        AND (
          audit."category" IS DISTINCT FROM 'payout'
          OR audit."status" IS DISTINCT FROM 'completed'
          OR CASE
            WHEN jsonb_typeof(audit."metadata"->'amount') = 'number'
              THEN (audit."metadata"->>'amount')::NUMERIC IS DISTINCT FROM NEW."amount"
            ELSE true
          END
          OR CASE audit."activity_type"
            WHEN 'payout_requested' THEN
              audit."user_id" IS DISTINCT FROM NEW."user_id"
              OR audit."user_role" IS DISTINCT FROM 'reseller'
              OR audit."metadata"->>'payment_method' IS DISTINCT FROM NEW."payment_method"
              OR (
                audit."metadata" ? 'reseller_id'
                AND audit."metadata"->>'reseller_id' IS DISTINCT FROM NEW."user_id"
              )
            WHEN 'payout_approved' THEN
              audit."user_id" IS DISTINCT FROM NEW."approved_by"
              OR audit."user_role" IS DISTINCT FROM 'admin'
              OR audit."metadata"->>'reseller_id' IS DISTINCT FROM NEW."user_id"
              OR audit."metadata"->>'transaction_number' IS DISTINCT FROM NEW."transaction_number"
            WHEN 'payout_rejected' THEN
              audit."user_id" IS DISTINCT FROM NEW."approved_by"
              OR audit."user_role" IS DISTINCT FROM 'admin'
              OR audit."metadata"->>'reseller_id' IS DISTINCT FROM NEW."user_id"
              OR audit."metadata"->>'notes' IS DISTINCT FROM NEW."notes"
            WHEN 'payout_released' THEN
              audit."user_id" IS DISTINCT FROM NEW."user_id"
              OR audit."user_role" IS DISTINCT FROM 'system'
              OR audit."metadata"->>'transaction_number' IS DISTINCT FROM NEW."transaction_number"
              OR (
                audit."metadata" ? 'reseller_id'
                AND audit."metadata"->>'reseller_id' IS DISTINCT FROM NEW."user_id"
              )
              OR (
                audit."metadata" ? 'actor_type'
                AND audit."metadata"->>'actor_type' IS DISTINCT FROM 'system'
              )
            ELSE true
          END
        )
    )::INTEGER
  INTO request_count, approval_count, rejection_count, release_count, invalid_count
  FROM "public"."audit_logs" audit
  WHERE audit."metadata"->>'payout_id' = NEW."id"
    AND audit."activity_type" = ANY (ARRAY[
      'payout_requested',
      'payout_approved',
      'payout_rejected',
      'payout_released'
    ]::TEXT[]);

  current_action := CASE NEW."status"
    WHEN 'pending'::"PayoutStatus" THEN 'payout_requested'
    WHEN 'approved'::"PayoutStatus" THEN 'payout_approved'
    WHEN 'rejected'::"PayoutStatus" THEN 'payout_rejected'
    WHEN 'released'::"PayoutStatus" THEN 'payout_released'
    ELSE NULL
  END;

  SELECT COUNT(*)::INTEGER
  INTO current_action_count
  FROM "public"."audit_logs" audit
  WHERE audit."metadata"->>'payout_id' = NEW."id"
    AND audit."activity_type" = current_action
    AND audit."created_at" = transaction_timestamp()
    AND CASE current_action
      WHEN 'payout_requested' THEN
        (audit."created_at" AT TIME ZONE 'UTC')::TIMESTAMP(3) IS NOT DISTINCT FROM NEW."requested_at"
      WHEN 'payout_approved' THEN
        (audit."created_at" AT TIME ZONE 'UTC')::TIMESTAMP(3) IS NOT DISTINCT FROM NEW."processed_at"
      WHEN 'payout_rejected' THEN
        (audit."created_at" AT TIME ZONE 'UTC')::TIMESTAMP(3) IS NOT DISTINCT FROM NEW."processed_at"
      WHEN 'payout_released' THEN
        audit."created_at" IS NOT DISTINCT FROM NEW."released_at"
      ELSE false
    END;

  IF request_count <> 1 OR invalid_count <> 0 OR current_action_count <> 1 THEN
    RAISE EXCEPTION 'Payout transition lacks one fresh exact canonical audit event.' USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'pending'::"PayoutStatus" THEN
    IF approval_count <> 0 OR rejection_count <> 0 OR release_count <> 0 THEN
      RAISE EXCEPTION 'Pending payout has a premature approval, rejection, or release audit event.' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."status" = 'approved'::"PayoutStatus" THEN
    IF approval_count <> 1 OR rejection_count <> 0 OR release_count <> 0 THEN
      RAISE EXCEPTION 'Approved payout lacks one exact approval audit chain.' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."status" = 'rejected'::"PayoutStatus" THEN
    IF approval_count <> 0 OR rejection_count <> 1 OR release_count <> 0 THEN
      RAISE EXCEPTION 'Rejected payout lacks one exact rejection audit chain.' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."status" = 'released'::"PayoutStatus" THEN
    IF approval_count <> 1 OR rejection_count <> 0 OR release_count <> 1 THEN
      RAISE EXCEPTION 'Released payout lacks one exact approval-and-release audit chain.' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Payout has an unsupported audit lifecycle state.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "require_valid_payout_audit_evidence"()
RETURNS TRIGGER AS $$
DECLARE
  payout_row RECORD;
BEGIN
  IF NOT (NEW."activity_type" = ANY (ARRAY[
    'payout_requested',
    'payout_approved',
    'payout_rejected',
    'payout_released'
  ]::TEXT[])) THEN
    RETURN NEW;
  END IF;

  SELECT
    payout."id",
    payout."user_id",
    payout."amount",
    payout."status",
    payout."payment_method",
    payout."transaction_number",
    payout."notes",
    payout."approved_by",
    payout."requested_at",
    payout."processed_at",
    payout."released_at"
  INTO payout_row
  FROM "public"."payouts" payout
  WHERE payout."id" = NEW."metadata"->>'payout_id';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical payout audit event references no payout.' USING ERRCODE = '23503';
  END IF;

  IF NEW."created_at" IS DISTINCT FROM transaction_timestamp()
     OR NEW."category" IS DISTINCT FROM 'payout'
     OR NEW."status" IS DISTINCT FROM 'completed'
     OR jsonb_typeof(NEW."metadata"->'amount') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Canonical payout audit event is not fresh and complete.' USING ERRCODE = '23514';
  END IF;

  IF (NEW."metadata"->>'amount')::NUMERIC IS DISTINCT FROM payout_row."amount" THEN
    RAISE EXCEPTION 'Canonical payout audit amount does not match its payout.' USING ERRCODE = '23514';
  END IF;

  IF NEW."activity_type" = 'payout_requested' THEN
    IF payout_row."status" <> 'pending'::"PayoutStatus"
       OR NEW."user_id" IS DISTINCT FROM payout_row."user_id"
       OR NEW."user_role" IS DISTINCT FROM 'reseller'
       OR NEW."metadata"->>'reseller_id' IS DISTINCT FROM payout_row."user_id"
       OR NEW."metadata"->>'payment_method' IS DISTINCT FROM payout_row."payment_method"
       OR (NEW."created_at" AT TIME ZONE 'UTC')::TIMESTAMP(3) IS DISTINCT FROM payout_row."requested_at" THEN
      RAISE EXCEPTION 'Payout-request audit evidence does not match the pending payout.' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."activity_type" = 'payout_approved' THEN
    IF payout_row."status" <> 'approved'::"PayoutStatus"
       OR NEW."user_id" IS DISTINCT FROM payout_row."approved_by"
       OR NEW."user_role" IS DISTINCT FROM 'admin'
       OR NEW."metadata"->>'reseller_id' IS DISTINCT FROM payout_row."user_id"
       OR NEW."metadata"->>'transaction_number' IS DISTINCT FROM payout_row."transaction_number"
       OR (NEW."created_at" AT TIME ZONE 'UTC')::TIMESTAMP(3) IS DISTINCT FROM payout_row."processed_at" THEN
      RAISE EXCEPTION 'Payout-approval audit evidence does not match the approved payout.' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."activity_type" = 'payout_rejected' THEN
    IF payout_row."status" <> 'rejected'::"PayoutStatus"
       OR NEW."user_id" IS DISTINCT FROM payout_row."approved_by"
       OR NEW."user_role" IS DISTINCT FROM 'admin'
       OR NEW."metadata"->>'reseller_id' IS DISTINCT FROM payout_row."user_id"
       OR NEW."metadata"->>'notes' IS DISTINCT FROM payout_row."notes"
       OR (NEW."created_at" AT TIME ZONE 'UTC')::TIMESTAMP(3) IS DISTINCT FROM payout_row."processed_at" THEN
      RAISE EXCEPTION 'Payout-rejection audit evidence does not match the rejected payout.' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."activity_type" = 'payout_released' THEN
    IF payout_row."status" <> 'released'::"PayoutStatus"
       OR NEW."user_id" IS DISTINCT FROM payout_row."user_id"
       OR NEW."user_role" IS DISTINCT FROM 'system'
       OR NEW."metadata"->>'reseller_id' IS DISTINCT FROM payout_row."user_id"
       OR NEW."metadata"->>'transaction_number' IS DISTINCT FROM payout_row."transaction_number"
       OR NEW."metadata"->>'actor_type' IS DISTINCT FROM 'system'
       OR NEW."created_at" IS DISTINCT FROM payout_row."released_at" THEN
      RAISE EXCEPTION 'Payout-release audit evidence does not match the released payout.' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "payouts_require_complete_audit_evidence" ON "payouts";
CREATE CONSTRAINT TRIGGER "payouts_require_complete_audit_evidence"
AFTER INSERT OR UPDATE OF "status" ON "payouts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_complete_payout_audit_evidence"();

DROP TRIGGER IF EXISTS "audit_logs_require_valid_payout_evidence" ON "audit_logs";
CREATE CONSTRAINT TRIGGER "audit_logs_require_valid_payout_evidence"
AFTER INSERT ON "audit_logs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_valid_payout_audit_evidence"();

-- Trigger invocation does not require callers to hold EXECUTE. Revoke the
-- default PUBLIC privilege so these functions cannot be reused on attacker-
-- controlled tables to manufacture trusted trigger depth or evidence.
REVOKE ALL ON FUNCTION "enforce_payout_identity_and_status_transition"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "require_complete_payout_audit_evidence"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "require_valid_payout_audit_evidence"() FROM PUBLIC;

COMMIT;
