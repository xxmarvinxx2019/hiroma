-- Package Binary commissions are earned from the exact cascade, eligibility,
-- and daily-cap result. Registration allocation remains a funding source, but
-- it must not erase or block a valid member liability when cascading produces
-- more payable pairs than the old per-registration reserve assumption.
BEGIN;

CREATE OR REPLACE FUNCTION "consume_binary_reserve"()
RETURNS TRIGGER AS $$
DECLARE
  remaining DECIMAL(12,2);
  lot RECORD;
  consumed DECIMAL(12,2);
BEGIN
  IF NEW."type" <> 'binary_pairing' OR NEW."amount" <= 0 THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('binary-reserve-funding'));

  IF EXISTS (
    SELECT 1 FROM "binary_reserve_consumptions"
    WHERE "commission_id" = NEW."id"
  ) THEN
    RETURN NEW;
  END IF;

  remaining := NEW."amount";
  WHILE remaining > 0 LOOP
    SELECT "id", "remaining_amount"
    INTO lot
    FROM "binary_reserve_lots"
    WHERE "remaining_amount" > 0
    ORDER BY "allocated_at" ASC, "id" ASC
    FOR UPDATE
    LIMIT 1;

    EXIT WHEN NOT FOUND;

    consumed := LEAST(remaining, lot."remaining_amount");
    UPDATE "binary_reserve_lots"
    SET "remaining_amount" = "remaining_amount" - consumed
    WHERE "id" = lot."id";

    INSERT INTO "binary_reserve_consumptions" (
      "reserve_lot_id", "commission_id", "amount", "is_unfunded", "consumed_at"
    ) VALUES (lot."id", NEW."id", consumed, false, NEW."created_at");

    remaining := remaining - consumed;
  END LOOP;

  IF remaining > 0 THEN
    INSERT INTO "binary_reserve_consumptions" (
      "reserve_lot_id", "commission_id", "amount", "is_unfunded", "consumed_at"
    ) VALUES (NULL, NEW."id", remaining, true, NEW."created_at");
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION "apply_wallet_ledger_entry"()
RETURNS TRIGGER AS $$
DECLARE
  commission_row "commissions"%ROWTYPE;
  payout_row "payouts"%ROWTYPE;
  recipient_role TEXT;
  recipient_status TEXT;
  funded_amount DECIMAL(12,2) := 0;
  unfunded_amount DECIMAL(12,2) := 0;
  source_available DECIMAL(12,2) := 0;
  earlier_pending DECIMAL(12,2) := 0;
  deactivation_amount DECIMAL(12,2) := 0;
  changed INTEGER := 0;
  reservation_exists BOOLEAN := false;
  reservation_release_exists BOOLEAN := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('financial-user:' || NEW."user_id"));

  SELECT u."role"::text, u."status"::text
  INTO recipient_role, recipient_status
  FROM "users" u
  WHERE u."id" = NEW."user_id"
  FOR SHARE;

  IF recipient_role IS NULL THEN
    RAISE EXCEPTION 'Wallet ledger recipient does not exist.' USING ERRCODE = '23503';
  END IF;

  IF NEW."entry_type" = 'commission_credit' THEN
    IF NEW."commission_id" IS NULL OR NEW."payout_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Commission credit requires one commission and no payout.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO commission_row FROM "commissions" WHERE "id" = NEW."commission_id" FOR SHARE;
    IF NOT FOUND OR commission_row."user_id" <> NEW."user_id"
       OR commission_row."is_pair_overflow" = true
       OR recipient_role <> 'reseller' OR recipient_status <> 'active'
       OR NEW."balance_delta" <> commission_row."amount"
       OR NEW."total_earned_delta" <> commission_row."amount"
       OR NEW."reserved_delta" <> 0 OR NEW."total_withdrawn_delta" <> 0
       OR NEW."source_kind" <> commission_row."source_event_kind"
       OR NEW."source_event_id" <> commission_row."source_event_id" THEN
      RAISE EXCEPTION 'Commission wallet credit does not match an active reseller commission.' USING ERRCODE = '23514';
    END IF;

    IF commission_row."type" = 'direct_referral'::"CommissionType" THEN
      SELECT rf."direct_referral_allocation" INTO funded_amount
      FROM "registration_financials" rf
      WHERE rf."pin_id" = commission_row."source_event_id"
        AND rf."payment_status" = 'paid'
      FOR SHARE;
      IF funded_amount IS NULL OR commission_row."source_event_kind" <> 'registration'
         OR commission_row."amount" > funded_amount THEN
        RAISE EXCEPTION 'Direct referral commission is not funded by its registration snapshot.' USING ERRCODE = '23514';
      END IF;
    ELSIF commission_row."type" = 'binary_pairing'::"CommissionType" THEN
      SELECT
        COALESCE(SUM(c."amount") FILTER (WHERE c."is_unfunded" = false), 0),
        COALESCE(SUM(c."amount") FILTER (WHERE c."is_unfunded" = true), 0)
      INTO funded_amount, unfunded_amount
      FROM "binary_reserve_consumptions" c
      WHERE c."commission_id" = commission_row."id";
      IF funded_amount + unfunded_amount <> commission_row."amount" THEN
        RAISE EXCEPTION 'Package Binary funding position is not fully accounted.' USING ERRCODE = '23514';
      END IF;
    ELSIF commission_row."type" = 'sponsor_point'::"CommissionType" THEN
      SELECT
        COALESCE(SUM(c."amount") FILTER (WHERE c."is_unfunded" = false), 0),
        COALESCE(SUM(c."amount") FILTER (WHERE c."is_unfunded" = true), 0)
      INTO funded_amount, unfunded_amount
      FROM "product_binary_funding_consumptions" c
      WHERE c."commission_id" = commission_row."id";
      IF funded_amount <> commission_row."amount" OR unfunded_amount <> 0 THEN
        RAISE EXCEPTION 'Product Binary commission is not fully funded.' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Unsupported commission cannot be credited.' USING ERRCODE = '23514';
    END IF;

  ELSIF NEW."entry_type" IN ('payout_reservation', 'payout_reservation_release', 'payout_disbursement') THEN
    IF NEW."payout_id" IS NULL OR NEW."commission_id" IS NOT NULL OR recipient_role <> 'reseller'
       OR NEW."source_kind" <> 'payout' OR NEW."source_event_id" <> NEW."payout_id" THEN
      RAISE EXCEPTION 'Payout ledger entry is invalid.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO payout_row FROM "payouts" WHERE "id" = NEW."payout_id" FOR SHARE;
    IF NOT FOUND OR payout_row."user_id" <> NEW."user_id" THEN
      RAISE EXCEPTION 'Payout ledger entry does not match its payout.' USING ERRCODE = '23514';
    END IF;

    IF NEW."entry_type" = 'payout_reservation' THEN
      SELECT
        COALESCE((SELECT SUM("remaining_amount") FROM "direct_referral_reserve_lots" WHERE "user_id" = NEW."user_id"), 0)
        + COALESCE((SELECT SUM("remaining_amount") FROM "binary_payable_lots" WHERE "user_id" = NEW."user_id"), 0)
        + COALESCE((SELECT SUM("remaining_amount") FROM "product_binary_payable_lots" WHERE "user_id" = NEW."user_id"), 0)
      INTO source_available;
      SELECT COALESCE(SUM("amount"), 0) INTO earlier_pending
      FROM "payouts"
      WHERE "user_id" = NEW."user_id" AND "status" = 'pending'::"PayoutStatus" AND "id" <> NEW."payout_id";
      IF payout_row."status" <> 'pending'::"PayoutStatus"
         OR NEW."reserved_delta" <> payout_row."amount"
         OR NEW."balance_delta" <> 0 OR NEW."total_earned_delta" <> 0 OR NEW."total_withdrawn_delta" <> 0
         OR source_available - earlier_pending < payout_row."amount" THEN
        RAISE EXCEPTION 'Payout reservation exceeds source-backed withdrawable funds.' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW."entry_type" = 'payout_reservation_release' THEN
      SELECT EXISTS (
        SELECT 1 FROM "wallet_ledger_entries"
        WHERE "payout_id" = NEW."payout_id" AND "entry_type" = 'payout_reservation'
      ) INTO reservation_exists;
      IF payout_row."status" <> 'rejected'::"PayoutStatus"
         OR reservation_exists = false
         OR NEW."reserved_delta" <> -payout_row."amount"
         OR NEW."balance_delta" <> 0 OR NEW."total_earned_delta" <> 0 OR NEW."total_withdrawn_delta" <> 0 THEN
        RAISE EXCEPTION 'Payout reservation release is invalid.' USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM "wallet_ledger_entries"
        WHERE "payout_id" = NEW."payout_id" AND "entry_type" = 'payout_reservation'
      ), EXISTS (
        SELECT 1 FROM "wallet_ledger_entries"
        WHERE "payout_id" = NEW."payout_id" AND "entry_type" = 'payout_reservation_release'
      ) INTO reservation_exists, reservation_release_exists;
      IF payout_row."status" <> 'released'::"PayoutStatus"
         OR reservation_exists = false OR reservation_release_exists = true
         OR NEW."balance_delta" <> -payout_row."amount"
         OR NEW."reserved_delta" <> -payout_row."amount"
         OR NEW."total_earned_delta" <> 0
         OR NEW."total_withdrawn_delta" <> payout_row."amount" THEN
        RAISE EXCEPTION 'Payout disbursement is invalid.' USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF NEW."entry_type" = 'deactivation_forfeit' THEN
    SELECT e."wallet_value" INTO deactivation_amount
    FROM "reseller_deactivation_events" e
    WHERE e."id" = NEW."source_event_id" AND e."reseller_id" = NEW."user_id"
    FOR SHARE;
    IF deactivation_amount IS NULL OR recipient_role <> 'reseller' OR recipient_status <> 'inactive'
       OR NEW."balance_delta" <> -deactivation_amount
       OR NEW."reserved_delta" <> 0 OR NEW."total_earned_delta" <> 0 OR NEW."total_withdrawn_delta" <> 0 THEN
      RAISE EXCEPTION 'Deactivation wallet forfeiture is invalid.' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported wallet ledger entry type.' USING ERRCODE = '23514';
  END IF;

  UPDATE "wallets"
  SET "balance" = "balance" + NEW."balance_delta",
      "reserved_balance" = "reserved_balance" + NEW."reserved_delta",
      "total_earned" = "total_earned" + NEW."total_earned_delta",
      "total_withdrawn" = "total_withdrawn" + NEW."total_withdrawn_delta",
      "updated_at" = CURRENT_TIMESTAMP
  WHERE "user_id" = NEW."user_id"
    AND "balance" + NEW."balance_delta" >= 0
    AND "reserved_balance" + NEW."reserved_delta" >= 0
    AND "balance" + NEW."balance_delta" >= "reserved_balance" + NEW."reserved_delta"
    AND "total_earned" + NEW."total_earned_delta" >= 0
    AND "total_withdrawn" + NEW."total_withdrawn_delta" >= 0;
  GET DIAGNOSTICS changed = ROW_COUNT;

  IF changed <> 1 THEN
    RAISE EXCEPTION 'Wallet ledger delta violates wallet balance invariants.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "wallet_ledger_entries_apply" ON "wallet_ledger_entries";
CREATE TRIGGER "wallet_ledger_entries_apply"
AFTER INSERT ON "wallet_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION "apply_wallet_ledger_entry"();

COMMIT;
