BEGIN;

-- No deactivation/status/audit writer may cross the boundary while fresh-time
-- evidence and independent zero-liability checks are being installed.
LOCK TABLE
  "audit_logs",
  "binary_payable_lots",
  "direct_referral_reserve_lots",
  "payouts",
  "product_binary_payable_lots",
  "product_binary_positions",
  "reseller_deactivation_events",
  "reseller_profiles",
  "users",
  "wallets"
IN SHARE ROW EXCLUSIVE MODE;

-- Security evidence must use the database transaction clock. A caller-chosen
-- future timestamp could otherwise be replayed as "fresh" evidence by a later
-- reseller status transition.
CREATE OR REPLACE FUNCTION "stamp_deactivation_liability_version"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."liability_liquidation_version" := 'deactivation-liability-v1';
  NEW."created_at" := transaction_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "stamp_audit_log_evidence_time"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."created_at" := transaction_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "audit_logs_stamp_evidence_time" ON "audit_logs";
CREATE TRIGGER "audit_logs_stamp_evidence_time"
BEFORE INSERT ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION "stamp_audit_log_evidence_time"();

-- This deliberately duplicates the most important financial closing checks
-- from the deactivation settlement verifier. The status transition and the
-- event must each prove that no spendable or payable member value survived.
CREATE OR REPLACE FUNCTION "verify_deactivation_fresh_zero_state"()
RETURNS TRIGGER AS $$
DECLARE
  wallet_count BIGINT := 0;
  wallet_balance DECIMAL(12,2) := 0;
  wallet_reserved DECIMAL(12,2) := 0;
  remaining_payable DECIMAL(12,2) := 0;
  open_payout_count BIGINT := 0;
  profile_count BIGINT := 0;
  profile_left INTEGER := 0;
  profile_right INTEGER := 0;
  profile_active BOOLEAN;
  product_left INTEGER := 0;
  product_right INTEGER := 0;
  audit_count BIGINT := 0;
  current_status TEXT;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(w."balance"), 0),
         COALESCE(SUM(w."reserved_balance"), 0)
  INTO wallet_count, wallet_balance, wallet_reserved
  FROM "wallets" w
  WHERE w."user_id" = NEW."reseller_id";

  SELECT
    COALESCE((SELECT SUM(l."remaining_amount") FROM "direct_referral_reserve_lots" l WHERE l."user_id" = NEW."reseller_id"), 0)
    + COALESCE((SELECT SUM(l."remaining_amount") FROM "binary_payable_lots" l WHERE l."user_id" = NEW."reseller_id"), 0)
    + COALESCE((SELECT SUM(l."remaining_amount") FROM "product_binary_payable_lots" l WHERE l."user_id" = NEW."reseller_id"), 0)
  INTO remaining_payable;

  SELECT COUNT(*)
  INTO open_payout_count
  FROM "payouts" p
  WHERE p."user_id" = NEW."reseller_id"
    AND p."status" IN ('pending'::"PayoutStatus", 'approved'::"PayoutStatus");

  SELECT COUNT(*), COALESCE(SUM(COALESCE(rp."left_points", 0)), 0)::INTEGER,
         COALESCE(SUM(COALESCE(rp."right_points", 0)), 0)::INTEGER,
         BOOL_AND(rp."is_active")
  INTO profile_count, profile_left, profile_right, profile_active
  FROM "reseller_profiles" rp
  WHERE rp."user_id" = NEW."reseller_id";

  SELECT COALESCE(SUM(position."left_carryover_pu"), 0)::INTEGER,
         COALESCE(SUM(position."right_carryover_pu"), 0)::INTEGER
  INTO product_left, product_right
  FROM "product_binary_positions" position
  WHERE position."user_id" = NEW."reseller_id";

  SELECT COUNT(*)
  INTO audit_count
  FROM "audit_logs" audit
  WHERE audit."activity_type" = 'reseller_deactivated'
    AND audit."status" = 'completed'
    AND audit."metadata"->>'deactivation_event_id' = NEW."id"
    AND audit."created_at" = NEW."created_at";

  SELECT u."status"::text
  INTO current_status
  FROM "users" u
  WHERE u."id" = NEW."reseller_id";

  IF NEW."created_at" IS DISTINCT FROM transaction_timestamp()
     OR audit_count <> 1
     OR current_status IS DISTINCT FROM 'inactive'
     OR wallet_count <> 1 OR wallet_balance <> 0 OR wallet_reserved <> 0
     OR remaining_payable <> 0 OR open_payout_count <> 0
     OR profile_count <> 1 OR profile_left <> 0 OR profile_right <> 0
     OR profile_active IS DISTINCT FROM false
     OR product_left <> 0 OR product_right <> 0 THEN
    RAISE EXCEPTION 'Deactivation requires fresh same-transaction evidence and a zero-liability closing state.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "reseller_deactivation_events_verify_fresh_zero_state" ON "reseller_deactivation_events";
CREATE CONSTRAINT TRIGGER "reseller_deactivation_events_verify_fresh_zero_state"
AFTER INSERT ON "reseller_deactivation_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "verify_deactivation_fresh_zero_state"();

-- Replace the status-transition guard so only evidence stamped by this exact
-- transaction can satisfy it. Inactivation also proves the zero state itself;
-- it does not trust the presence of a deactivation event alone. Suspension is
-- intentionally different: it disables activity but does not liquidate value.
CREATE OR REPLACE FUNCTION "verify_reseller_status_transition"()
RETURNS TRIGGER AS $$
DECLARE
  profile_count BIGINT := 0;
  profile_active BOOLEAN;
  profile_left INTEGER := 0;
  profile_right INTEGER := 0;
  product_left INTEGER := 0;
  product_right INTEGER := 0;
  evidence_count BIGINT := 0;
  wallet_count BIGINT := 0;
  wallet_balance DECIMAL(12,2) := 0;
  wallet_reserved DECIMAL(12,2) := 0;
  remaining_payable DECIMAL(12,2) := 0;
  open_payout_count BIGINT := 0;
  current_status TEXT;
BEGIN
  IF OLD."role" <> 'reseller'::"Role"
     OR NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*), BOOL_AND(rp."is_active"),
         COALESCE(SUM(COALESCE(rp."left_points", 0)), 0)::INTEGER,
         COALESCE(SUM(COALESCE(rp."right_points", 0)), 0)::INTEGER
  INTO profile_count, profile_active, profile_left, profile_right
  FROM "reseller_profiles" rp
  WHERE rp."user_id" = NEW."id";

  SELECT u."status"::text
  INTO current_status
  FROM "users" u
  WHERE u."id" = NEW."id";

  IF current_status IS DISTINCT FROM NEW."status"::text
     OR profile_count <> 1
     OR profile_active IS DISTINCT FROM (NEW."status" = 'active'::"UserStatus") THEN
    RAISE EXCEPTION 'Reseller status and profile activity are inconsistent.' USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'inactive'::"UserStatus" THEN
    SELECT COUNT(*)
    INTO evidence_count
    FROM "reseller_deactivation_events" event
    WHERE event."reseller_id" = NEW."id"
      AND event."liability_liquidation_version" = 'deactivation-liability-v1'
      AND event."created_at" = transaction_timestamp();

    SELECT COUNT(*), COALESCE(SUM(w."balance"), 0),
           COALESCE(SUM(w."reserved_balance"), 0)
    INTO wallet_count, wallet_balance, wallet_reserved
    FROM "wallets" w
    WHERE w."user_id" = NEW."id";

    SELECT
      COALESCE((SELECT SUM(l."remaining_amount") FROM "direct_referral_reserve_lots" l WHERE l."user_id" = NEW."id"), 0)
      + COALESCE((SELECT SUM(l."remaining_amount") FROM "binary_payable_lots" l WHERE l."user_id" = NEW."id"), 0)
      + COALESCE((SELECT SUM(l."remaining_amount") FROM "product_binary_payable_lots" l WHERE l."user_id" = NEW."id"), 0)
    INTO remaining_payable;

    SELECT COUNT(*)
    INTO open_payout_count
    FROM "payouts" p
    WHERE p."user_id" = NEW."id"
      AND p."status" IN ('pending'::"PayoutStatus", 'approved'::"PayoutStatus");

    SELECT COALESCE(SUM(position."left_carryover_pu"), 0)::INTEGER,
           COALESCE(SUM(position."right_carryover_pu"), 0)::INTEGER
    INTO product_left, product_right
    FROM "product_binary_positions" position
    WHERE position."user_id" = NEW."id";

    IF evidence_count <> 1
       OR wallet_count <> 1 OR wallet_balance <> 0 OR wallet_reserved <> 0
       OR remaining_payable <> 0 OR open_payout_count <> 0
       OR profile_left <> 0 OR profile_right <> 0
       OR product_left <> 0 OR product_right <> 0 THEN
      RAISE EXCEPTION 'Inactive reseller transition requires one fresh sealed settlement and zero remaining liability or carryover.' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT COUNT(*)
    INTO evidence_count
    FROM "audit_logs" audit
    WHERE audit."activity_type" = 'reseller_status_changed'
      AND audit."status" = 'completed'
      AND audit."metadata"->>'reseller_id' = NEW."id"
      AND audit."metadata"->>'to_status' = NEW."status"::text
      AND audit."created_at" = transaction_timestamp();

    IF evidence_count <> 1 THEN
      RAISE EXCEPTION 'Reseller activation or suspension requires one fresh immutable audit event.' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
