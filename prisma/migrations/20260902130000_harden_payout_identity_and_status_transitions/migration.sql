-- Payout identity is part of the financial ledger. Once created, neither the
-- recipient nor the amount may change, and status may only advance through the
-- approved release workflow.
BEGIN;

DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'Hiroma financial migrations require PostgreSQL 15 or newer.';
  END IF;
END $$;

LOCK TABLE
  "binary_payout_consumptions",
  "direct_referral_payout_consumptions",
  "payouts",
  "product_binary_payout_consumptions"
IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION "enforce_payout_identity_and_status_transition"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'pending' THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'Payouts must be created in pending status.',
        DETAIL = format(
          'payout_id=%s attempted_status=%s',
          NEW."id",
          NEW."status"
        );
    END IF;

    RETURN NEW;
  END IF;

  IF NEW."user_id" IS DISTINCT FROM OLD."user_id" THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Payout recipient is immutable after creation.',
      DETAIL = format(
        'payout_id=%s original_user_id=%s attempted_user_id=%s',
        OLD."id",
        OLD."user_id",
        NEW."user_id"
      );
  END IF;

  IF NEW."amount" IS DISTINCT FROM OLD."amount" THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Payout amount is immutable after creation.',
      DETAIL = format(
        'payout_id=%s original_amount=%s attempted_amount=%s',
        OLD."id",
        OLD."amount",
        NEW."amount"
      );
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" = 'pending' AND NEW."status" IN ('approved', 'rejected') THEN
      RETURN NEW;
    END IF;

    IF OLD."status" = 'approved' AND NEW."status" = 'released' THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Illegal payout status transition.',
      DETAIL = format(
        'payout_id=%s from_status=%s to_status=%s',
        OLD."id",
        OLD."status",
        NEW."status"
      );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "payouts_enforce_identity_and_transitions" ON "payouts";
CREATE TRIGGER "payouts_enforce_identity_and_transitions"
BEFORE INSERT OR UPDATE OF "user_id", "amount", "status" ON "payouts"
FOR EACH ROW EXECUTE FUNCTION "enforce_payout_identity_and_status_transition"();

-- The final allocation verifier should re-run on any attempted change to the
-- payout's financial identity, even though the BEFORE trigger above now
-- rejects amount/user edits.
DROP TRIGGER IF EXISTS "zzzz_payouts_require_full_source_allocation" ON "payouts";
CREATE TRIGGER "zzzz_payouts_require_full_source_allocation"
AFTER INSERT OR UPDATE OF "status", "user_id", "amount" ON "payouts"
FOR EACH ROW EXECUTE FUNCTION "require_fully_allocated_approved_payout"();

COMMIT;
