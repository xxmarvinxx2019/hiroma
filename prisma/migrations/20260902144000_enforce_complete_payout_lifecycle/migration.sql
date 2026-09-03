-- Close the last payout lifecycle gaps. A payout is not merely a status row:
-- every final status must have the exact immutable wallet-ledger evidence that
-- makes that status true. The deferred check allows the route to write the
-- status and its ledger entry in either order inside one database transaction,
-- while still refusing an incomplete state at COMMIT.

BEGIN;

DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'Hiroma financial migrations require PostgreSQL 15 or newer.';
  END IF;
END $$;

-- Stop wallet, payout, and source-lot mutation while legacy lifecycle evidence
-- is checked. All tables follow the common alphabetical cutover order.
LOCK TABLE
  "audit_logs",
  "binary_payable_lots",
  "binary_payout_consumptions",
  "direct_referral_payout_consumptions",
  "direct_referral_reserve_lots",
  "payouts",
  "product_binary_payable_lots",
  "product_binary_payout_consumptions",
  "users",
  "wallet_ledger_entries",
  "wallets"
IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  duplicate_users TEXT;
BEGIN
  SELECT string_agg(x."user_id", ', ' ORDER BY x."user_id")
  INTO duplicate_users
  FROM (
    SELECT "user_id"
    FROM "payouts"
    WHERE "status" = 'pending'::"PayoutStatus"
    GROUP BY "user_id"
    HAVING COUNT(*) > 1
    LIMIT 25
  ) x;

  IF duplicate_users IS NOT NULL THEN
    RAISE EXCEPTION 'Members with duplicate pending payouts require reconciliation before payout-lifecycle migration: %', duplicate_users
      USING ERRCODE = '23505';
  END IF;
END $$;

-- Existing lifecycle rows are admitted only when their exact reservation,
-- release/disbursement, allocation, recipient, and reviewer evidence already
-- agrees. Closed legacy payouts cannot be reconstructed from a status label.
DO $$
DECLARE
  unresolved_count BIGINT;
  unresolved_ids TEXT;
BEGIN
  WITH evidence AS (
    SELECT
      p.*,
      recipient."role"::text AS recipient_role,
      reviewer."role"::text AS reviewer_role,
      reviewer."status"::text AS reviewer_status,
      ledger.reservation_count,
      ledger.reservation_amount,
      ledger.invalid_reservation_count,
      ledger.release_count,
      ledger.release_amount,
      ledger.invalid_release_count,
      ledger.disbursement_count,
      ledger.disbursement_amount,
      ledger.invalid_disbursement_count,
      ledger.wrong_user_count,
      ledger.unsupported_entry_count,
      allocation.allocated_amount
    FROM "payouts" p
    LEFT JOIN "users" recipient ON recipient."id" = p."user_id"
    LEFT JOIN "users" reviewer ON reviewer."id" = p."approved_by"
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE le."entry_type" = 'payout_reservation')::INTEGER AS reservation_count,
        COALESCE(SUM(le."reserved_delta") FILTER (WHERE le."entry_type" = 'payout_reservation'), 0)::DECIMAL(12,2) AS reservation_amount,
        COUNT(*) FILTER (
          WHERE le."entry_type" = 'payout_reservation'
            AND (le."balance_delta" <> 0 OR le."reserved_delta" <> p."amount"
              OR le."total_earned_delta" <> 0 OR le."total_withdrawn_delta" <> 0
              OR le."source_kind" <> 'payout' OR le."source_event_id" <> p."id")
        )::INTEGER AS invalid_reservation_count,
        COUNT(*) FILTER (WHERE le."entry_type" = 'payout_reservation_release')::INTEGER AS release_count,
        COALESCE(SUM(le."reserved_delta") FILTER (WHERE le."entry_type" = 'payout_reservation_release'), 0)::DECIMAL(12,2) AS release_amount,
        COUNT(*) FILTER (
          WHERE le."entry_type" = 'payout_reservation_release'
            AND (le."balance_delta" <> 0 OR le."reserved_delta" <> -p."amount"
              OR le."total_earned_delta" <> 0 OR le."total_withdrawn_delta" <> 0
              OR le."source_kind" <> 'payout' OR le."source_event_id" <> p."id")
        )::INTEGER AS invalid_release_count,
        COUNT(*) FILTER (WHERE le."entry_type" = 'payout_disbursement')::INTEGER AS disbursement_count,
        COALESCE(SUM(-le."balance_delta") FILTER (WHERE le."entry_type" = 'payout_disbursement'), 0)::DECIMAL(12,2) AS disbursement_amount,
        COUNT(*) FILTER (
          WHERE le."entry_type" = 'payout_disbursement'
            AND (le."balance_delta" <> -p."amount" OR le."reserved_delta" <> -p."amount"
              OR le."total_earned_delta" <> 0 OR le."total_withdrawn_delta" <> p."amount"
              OR le."source_kind" <> 'payout' OR le."source_event_id" <> p."id")
        )::INTEGER AS invalid_disbursement_count,
        COUNT(*) FILTER (WHERE le."user_id" <> p."user_id")::INTEGER AS wrong_user_count,
        COUNT(*) FILTER (
          WHERE le."entry_type" NOT IN (
            'payout_reservation', 'payout_reservation_release', 'payout_disbursement'
          )
        )::INTEGER AS unsupported_entry_count
      FROM "wallet_ledger_entries" le
      WHERE le."payout_id" = p."id"
    ) ledger ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(source."amount"), 0)::DECIMAL(12,2) AS allocated_amount
      FROM (
        SELECT c."amount" FROM "direct_referral_payout_consumptions" c WHERE c."payout_id" = p."id"
        UNION ALL
        SELECT c."amount" FROM "binary_payout_consumptions" c WHERE c."payout_id" = p."id"
        UNION ALL
        SELECT c."amount" FROM "product_binary_payout_consumptions" c WHERE c."payout_id" = p."id"
      ) source
    ) allocation ON true
  ), unresolved AS (
    SELECT e."id"
    FROM evidence e
    WHERE e.recipient_role IS DISTINCT FROM 'reseller'
       OR e."amount" <= 0
       OR e."payment_method" IS NULL OR length(btrim(e."payment_method")) = 0
       OR e."cutoff_date" IS NULL OR e."payout_date" IS NULL
       OR e.reservation_count <> 1 OR e.reservation_amount <> e."amount"
       OR e.invalid_reservation_count <> 0 OR e.wrong_user_count <> 0
       OR e.unsupported_entry_count <> 0
       OR CASE e."status"
         WHEN 'pending'::"PayoutStatus" THEN
           e."approved_by" IS NOT NULL OR e."processed_at" IS NOT NULL
           OR e."released_at" IS NOT NULL OR e."transaction_number" IS NOT NULL
           OR e.release_count <> 0 OR e.disbursement_count <> 0
           OR e.allocated_amount <> 0
         WHEN 'rejected'::"PayoutStatus" THEN
           e."approved_by" IS NULL OR e.reviewer_role IS DISTINCT FROM 'admin'
           OR e.reviewer_status IS DISTINCT FROM 'active'
           OR e."processed_at" IS NULL OR e."released_at" IS NOT NULL
           OR e."transaction_number" IS NOT NULL
           OR e.release_count <> 1 OR e.release_amount <> -e."amount"
           OR e.invalid_release_count <> 0 OR e.disbursement_count <> 0
           OR e.allocated_amount <> 0
         WHEN 'approved'::"PayoutStatus" THEN
           e."approved_by" IS NULL OR e.reviewer_role IS DISTINCT FROM 'admin'
           OR e.reviewer_status IS DISTINCT FROM 'active'
           OR e."processed_at" IS NULL OR e."released_at" IS NOT NULL
           OR e."transaction_number" IS NULL OR length(btrim(e."transaction_number")) = 0
           OR e.release_count <> 0 OR e.disbursement_count <> 0
           OR e.allocated_amount <> e."amount"
         WHEN 'released'::"PayoutStatus" THEN
           e."approved_by" IS NULL OR e.reviewer_role IS DISTINCT FROM 'admin'
           OR e.reviewer_status IS DISTINCT FROM 'active'
           OR e."processed_at" IS NULL OR e."released_at" IS NULL
           OR e."transaction_number" IS NULL OR length(btrim(e."transaction_number")) = 0
           OR e.release_count <> 0 OR e.disbursement_count <> 1
           OR e.disbursement_amount <> e."amount" OR e.invalid_disbursement_count <> 0
           OR e.allocated_amount <> e."amount"
         ELSE true
       END
  ), ordered AS (
    SELECT "id", row_number() OVER (ORDER BY "id") AS row_number FROM unresolved
  )
  SELECT COUNT(*), string_agg("id", ', ' ORDER BY "id") FILTER (WHERE row_number <= 50)
  INTO unresolved_count, unresolved_ids
  FROM ordered;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Existing payout lifecycle rows lack exact authoritative ledger evidence.',
      DETAIL = format(
        'unresolved_payouts=%s first_payout_ids=%s',
        unresolved_count,
        COALESCE(unresolved_ids, '(none)')
      ),
      HINT = 'Apply a separately reviewed evidence-based reconciliation before retrying. Never create reservation, release, allocation, or disbursement history from status alone.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "payouts_one_pending_per_user"
  ON "payouts" ("user_id")
  WHERE "status" = 'pending'::"PayoutStatus";

CREATE OR REPLACE FUNCTION "enforce_payout_identity_and_status_transition"()
RETURNS TRIGGER AS $$
DECLARE
  approver_role TEXT;
  approver_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
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
    IF NEW."approved_by" IS NULL OR NEW."processed_at" IS NULL OR NEW."released_at" IS NOT NULL THEN
      RAISE EXCEPTION 'Payout approval or rejection requires complete reviewer evidence.' USING ERRCODE = '23514';
    END IF;
    SELECT u."role"::text, u."status"::text
    INTO approver_role, approver_status
    FROM "users" u WHERE u."id" = NEW."approved_by" FOR SHARE;
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
    IF NEW."approved_by" IS DISTINCT FROM OLD."approved_by"
       OR NEW."processed_at" IS DISTINCT FROM OLD."processed_at"
       OR NEW."transaction_number" IS DISTINCT FROM OLD."transaction_number"
       OR NEW."notes" IS DISTINCT FROM OLD."notes"
       OR NEW."released_at" IS NULL THEN
      RAISE EXCEPTION 'Payout release must preserve approval evidence and record its release time.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal payout status transition.' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "payouts_enforce_identity_and_transitions" ON "payouts";
CREATE TRIGGER "payouts_enforce_identity_and_transitions"
BEFORE INSERT OR UPDATE ON "payouts"
FOR EACH ROW EXECUTE FUNCTION "enforce_payout_identity_and_status_transition"();

CREATE OR REPLACE FUNCTION "require_complete_payout_ledger_state"()
RETURNS TRIGGER AS $$
DECLARE
  reservation_count INTEGER;
  reservation_amount DECIMAL(12,2);
  release_count INTEGER;
  release_amount DECIMAL(12,2);
  disbursement_count INTEGER;
  disbursement_amount DECIMAL(12,2);
  allocation_amount DECIMAL(12,2);
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE "entry_type" = 'payout_reservation')::INTEGER,
    COALESCE(SUM("reserved_delta") FILTER (WHERE "entry_type" = 'payout_reservation'), 0),
    COUNT(*) FILTER (WHERE "entry_type" = 'payout_reservation_release')::INTEGER,
    COALESCE(SUM("reserved_delta") FILTER (WHERE "entry_type" = 'payout_reservation_release'), 0),
    COUNT(*) FILTER (WHERE "entry_type" = 'payout_disbursement')::INTEGER,
    COALESCE(SUM(-"balance_delta") FILTER (WHERE "entry_type" = 'payout_disbursement'), 0)
  INTO reservation_count, reservation_amount, release_count, release_amount,
       disbursement_count, disbursement_amount
  FROM "wallet_ledger_entries"
  WHERE "payout_id" = NEW."id";

  SELECT COALESCE(SUM(x."amount"), 0)
  INTO allocation_amount
  FROM (
    SELECT "amount" FROM "direct_referral_payout_consumptions" WHERE "payout_id" = NEW."id"
    UNION ALL
    SELECT "amount" FROM "binary_payout_consumptions" WHERE "payout_id" = NEW."id"
    UNION ALL
    SELECT "amount" FROM "product_binary_payout_consumptions" WHERE "payout_id" = NEW."id"
  ) x;

  IF reservation_count <> 1 OR reservation_amount <> NEW."amount" THEN
    RAISE EXCEPTION 'Payout does not have exactly one matching wallet reservation.' USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'pending'::"PayoutStatus" THEN
    IF release_count <> 0 OR disbursement_count <> 0 OR allocation_amount <> 0 THEN
      RAISE EXCEPTION 'Pending payout has premature release, disbursement, or source allocation.' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."status" = 'rejected'::"PayoutStatus" THEN
    IF release_count <> 1 OR release_amount <> -NEW."amount"
       OR disbursement_count <> 0 OR allocation_amount <> 0 THEN
      RAISE EXCEPTION 'Rejected payout does not have one exact reservation release.' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."status" = 'approved'::"PayoutStatus" THEN
    IF release_count <> 0 OR disbursement_count <> 0 OR allocation_amount <> NEW."amount" THEN
      RAISE EXCEPTION 'Approved payout is not fully allocated and still reserved.' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."status" = 'released'::"PayoutStatus" THEN
    IF release_count <> 0 OR disbursement_count <> 1
       OR disbursement_amount <> NEW."amount" OR allocation_amount <> NEW."amount" THEN
      RAISE EXCEPTION 'Released payout lacks one exact funded wallet disbursement.' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Payout has an unsupported lifecycle state.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "payouts_require_complete_ledger_state" ON "payouts";
CREATE CONSTRAINT TRIGGER "payouts_require_complete_ledger_state"
AFTER INSERT OR UPDATE OF "status" ON "payouts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_complete_payout_ledger_state"();

-- Audit evidence is part of the control record. Corrections must be appended
-- as a new audit entry; silently editing or deleting an old entry is forbidden.
DROP TRIGGER IF EXISTS "audit_logs_append_only" ON "audit_logs";
CREATE TRIGGER "audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_change"();

COMMIT;
