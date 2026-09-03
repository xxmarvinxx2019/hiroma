-- Company-retained wallets (including the Hiroma admin sink) are accounting
-- balances, not member withdrawal accounts. Payouts are a reseller-only
-- workflow in the application; enforce the same boundary in PostgreSQL.
BEGIN;

DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'Hiroma financial migrations require PostgreSQL 15 or newer.';
  END IF;
END $$;

-- Financial migrations use one documented alphabetical lock order. These
-- locks stop payout creation and role changes while the legacy preflight and
-- trigger installation observe one stable database state.
LOCK TABLE "payouts", "users" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  invalid_payouts BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO invalid_payouts
  FROM "payouts" p
  JOIN "users" u ON u."id" = p."user_id"
  WHERE u."role" <> 'reseller'::"Role";

  IF invalid_payouts > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Non-reseller payout records require reconciliation.',
      DETAIL = format('invalid_payouts=%s', invalid_payouts);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "enforce_reseller_payout_recipient"()
RETURNS TRIGGER AS $$
DECLARE
  recipient_role "Role";
BEGIN
  SELECT "role"
  INTO recipient_role
  FROM "users"
  WHERE "id" = NEW."user_id"
  FOR SHARE;

  IF recipient_role IS NULL OR recipient_role <> 'reseller'::"Role" THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Payout recipient must be a reseller.',
      DETAIL = format('payout_id=%s user_id=%s', NEW."id", NEW."user_id");
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "payouts_require_reseller_recipient" ON "payouts";
CREATE TRIGGER "payouts_require_reseller_recipient"
BEFORE INSERT OR UPDATE ON "payouts"
FOR EACH ROW EXECUTE FUNCTION "enforce_reseller_payout_recipient"();

-- Serialize role transitions with payout creation through the same user row.
-- A reseller with payout history remains a reseller so every payout row keeps
-- satisfying the recipient invariant, including during concurrent writes.
CREATE OR REPLACE FUNCTION "prevent_payout_recipient_role_change"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."role" = 'reseller'::"Role"
     AND NEW."role" <> 'reseller'::"Role"
     AND EXISTS (
       SELECT 1
       FROM "payouts"
       WHERE "user_id" = OLD."id"
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'A reseller with payout records cannot change to a non-reseller role.',
      DETAIL = format('user_id=%s requested_role=%s', OLD."id", NEW."role");
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "users_preserve_reseller_payout_recipient" ON "users";
CREATE TRIGGER "users_preserve_reseller_payout_recipient"
BEFORE UPDATE OF "role" ON "users"
FOR EACH ROW EXECUTE FUNCTION "prevent_payout_recipient_role_change"();

COMMIT;
