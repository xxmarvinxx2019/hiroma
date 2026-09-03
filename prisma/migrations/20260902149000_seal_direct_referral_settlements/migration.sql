BEGIN;

DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'Hiroma financial migrations require PostgreSQL 15 or newer.';
  END IF;
END $$;

-- Prevent a registration or direct commission from committing after the
-- event table is created but before reverse completeness triggers exist.
LOCK TABLE
  "binary_tree_nodes",
  "commissions",
  "registration_financials",
  "reseller_profiles"
IN SHARE ROW EXCLUSIVE MODE;

-- The historical migration chain creates these ledger identities as native
-- UUIDs. A database that was created with `prisma db push` from an older
-- schema can instead contain TEXT columns. Do not silently rewrite identity
-- types during this financial cutover: fail before creating any settlement
-- object so an operator can reconcile and test an explicit remediation on a
-- staging clone.
DO $$
DECLARE
  target RECORD;
  native_type OID;
BEGIN
  FOR target IN
    SELECT *
    FROM (VALUES
      ('registration_financials', 'id'),
      ('upgrade_financials', 'id'),
      ('binary_reserve_lots', 'id'),
      ('binary_reserve_lots', 'registration_financial_id'),
      ('binary_reserve_lots', 'upgrade_financial_id'),
      ('binary_reserve_consumptions', 'id'),
      ('binary_reserve_consumptions', 'reserve_lot_id')
    ) AS required(table_name, column_name)
  LOOP
    SELECT attribute.atttypid
    INTO native_type
    FROM pg_attribute attribute
    WHERE attribute.attrelid = to_regclass('public.' || target.table_name)
      AND attribute.attname = target.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF native_type IS NULL OR native_type <> 'uuid'::regtype THEN
      RAISE EXCEPTION
        'Financial native-type preflight failed: %.% must be UUID before Direct Referral settlement cutover.',
        target.table_name,
        target.column_name
        USING ERRCODE = '42804',
              HINT = 'Stop deployment. Reconcile schema drift and test an explicit TEXT-to-UUID remediation on a production-sized staging clone.';
    END IF;
  END LOOP;
END $$;

CREATE TABLE "direct_referral_settlement_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "registration_financial_id" UUID NOT NULL,
  "source_event_id" VARCHAR(255) NOT NULL,
  "sponsor_user_id" TEXT NOT NULL,
  "referred_user_id" TEXT NOT NULL,
  "sponsor_package_id" TEXT,
  "package_name_snapshot" VARCHAR NOT NULL,
  "sponsor_bonus_snapshot" DECIMAL(12,2) NOT NULL,
  "source_allocation" DECIMAL(12,2) NOT NULL,
  "cap_enabled" BOOLEAN NOT NULL,
  "cap_limit" INTEGER NOT NULL,
  "settlement_day" DATE NOT NULL,
  "opening_daily_referral_count" INTEGER NOT NULL,
  "closing_daily_referral_count" INTEGER NOT NULL,
  "recipient_eligible" BOOLEAN NOT NULL,
  "disposition" VARCHAR(40) NOT NULL,
  "payable_amount" DECIMAL(12,2) NOT NULL,
  "retained_amount" DECIMAL(12,2) NOT NULL,
  "normal_commission_id" TEXT,
  "retained_commission_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "direct_referral_settlement_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "direct_referral_settlement_amounts_check" CHECK (
    "sponsor_bonus_snapshot" >= 0
    AND "source_allocation" >= 0
    AND "cap_limit" >= 0
    AND "opening_daily_referral_count" >= 0
    AND "closing_daily_referral_count" >= 0
    AND "payable_amount" >= 0
    AND "retained_amount" >= 0
    AND "payable_amount" + "retained_amount" = "source_allocation"
  ),
  CONSTRAINT "direct_referral_settlement_disposition_check" CHECK (
    "disposition" IN (
      'paid',
      'paid_with_package_remainder',
      'retained_package_difference',
      'retained_cap',
      'retained_ineligible',
      'retained_system_root'
    )
  ),
  CONSTRAINT "direct_referral_settlement_registration_fkey"
    FOREIGN KEY ("registration_financial_id")
    REFERENCES "registration_financials"("id") ON DELETE RESTRICT,
  CONSTRAINT "direct_referral_settlement_normal_commission_fkey"
    FOREIGN KEY ("normal_commission_id")
    REFERENCES "commissions"("id") ON DELETE RESTRICT,
  CONSTRAINT "direct_referral_settlement_retained_commission_fkey"
    FOREIGN KEY ("retained_commission_id")
    REFERENCES "commissions"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "direct_referral_settlement_events_registration_financial_id_key"
  ON "direct_referral_settlement_events"("registration_financial_id");
CREATE UNIQUE INDEX "direct_referral_settlement_events_source_event_id_key"
  ON "direct_referral_settlement_events"("source_event_id");
CREATE UNIQUE INDEX "direct_referral_settlement_events_normal_commission_id_key"
  ON "direct_referral_settlement_events"("normal_commission_id")
  WHERE "normal_commission_id" IS NOT NULL;
CREATE UNIQUE INDEX "direct_referral_settlement_events_retained_commission_id_key"
  ON "direct_referral_settlement_events"("retained_commission_id")
  WHERE "retained_commission_id" IS NOT NULL;
CREATE INDEX "direct_referral_settlement_events_sponsor_day_idx"
  ON "direct_referral_settlement_events"("sponsor_user_id", "settlement_day");
CREATE INDEX "direct_referral_settlement_events_referred_created_idx"
  ON "direct_referral_settlement_events"("referred_user_id", "created_at");

CREATE OR REPLACE FUNCTION "validate_direct_referral_settlement_insert"()
RETURNS TRIGGER AS $$
DECLARE
  financial RECORD;
  sponsor RECORD;
  system_account_count INTEGER;
  expected_opening INTEGER;
  expected_eligible BOOLEAN;
  expected_cap_exceeded BOOLEAN;
  expected_payable DECIMAL(12,2);
  expected_retained DECIMAL(12,2);
  expected_closing INTEGER;
  expected_disposition TEXT;
  normal_match_count INTEGER;
  retained_match_count INTEGER;
BEGIN
  NEW."created_at" := transaction_timestamp();

  SELECT rf."id", rf."pin_id", rf."reseller_id", rf."direct_referral_allocation"
  INTO financial
  FROM "registration_financials" rf
  WHERE rf."id" = NEW."registration_financial_id"
    AND rf."pin_id" = NEW."source_event_id"
    AND rf."reseller_id" = NEW."referred_user_id"
    AND rf."payment_status" = 'paid'
  FOR SHARE;

  IF financial."id" IS NULL
     OR NEW."source_allocation" IS DISTINCT FROM financial."direct_referral_allocation"
     OR NEW."settlement_day" IS DISTINCT FROM
        (transaction_timestamp() AT TIME ZONE 'Asia/Manila')::date THEN
    RAISE EXCEPTION 'Direct Referral event does not match one paid registration allocation.' USING ERRCODE = '23514';
  END IF;

  IF NEW."disposition" = 'retained_system_root' THEN
    SELECT COUNT(*)::INTEGER
    INTO system_account_count
    FROM "users" account
    WHERE account."id" = NEW."sponsor_user_id"
      AND account."username" = 'hiroma'
      AND account."role" = 'admin'::"Role";

    IF system_account_count IS DISTINCT FROM 1
       OR NEW."sponsor_package_id" IS NOT NULL
       OR NEW."package_name_snapshot" IS DISTINCT FROM 'Hiroma system root'
       OR NEW."sponsor_bonus_snapshot" IS DISTINCT FROM 0
       OR NEW."cap_enabled"
       OR NEW."cap_limit" IS DISTINCT FROM 0
       OR NEW."opening_daily_referral_count" IS DISTINCT FROM 0
       OR NEW."closing_daily_referral_count" IS DISTINCT FROM 0
       OR NEW."recipient_eligible"
       OR NEW."payable_amount" IS DISTINCT FROM 0
       OR NEW."retained_amount" IS DISTINCT FROM NEW."source_allocation"
       OR NEW."normal_commission_id" IS NOT NULL
       OR NEW."retained_commission_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Hiroma root Direct Referral retention is not exact.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT profile."package_id",
         package."name" AS package_name,
         package."direct_referral_bonus"::DECIMAL(12,2) AS sponsor_bonus,
         COALESCE(package."direct_referral_cap_enabled", true) AS cap_enabled,
         GREATEST(COALESCE(package."daily_referral_cap", 10), 0)::INTEGER AS cap_limit,
         user_row."role"::TEXT AS role,
         user_row."status"::TEXT AS status,
         CASE
           WHEN (profile."last_referral_date" AT TIME ZONE 'Asia/Manila')::date = NEW."settlement_day"
             THEN GREATEST(profile."daily_referral_count", 0)
           ELSE 0
         END::INTEGER AS effective_count
  INTO sponsor
  FROM "reseller_profiles" profile
  JOIN "users" user_row ON user_row."id" = profile."user_id"
  JOIN "packages" package ON package."id" = profile."package_id"
  WHERE profile."user_id" = NEW."sponsor_user_id"
  FOR UPDATE OF profile, user_row FOR SHARE OF package;

  IF sponsor."package_id" IS NULL THEN
    RAISE EXCEPTION 'Direct Referral sponsor profile is missing.' USING ERRCODE = '23514';
  END IF;

  expected_opening := sponsor."effective_count";
  expected_eligible := sponsor."role" = 'reseller' AND sponsor."status" = 'active';
  expected_cap_exceeded := sponsor."cap_enabled" AND expected_opening >= sponsor."cap_limit";
  expected_payable := CASE
    WHEN expected_eligible AND NOT expected_cap_exceeded
      THEN LEAST(sponsor."sponsor_bonus", NEW."source_allocation")
    ELSE 0
  END;
  expected_retained := NEW."source_allocation" - expected_payable;
  expected_closing := expected_opening +
    CASE WHEN expected_eligible AND NOT expected_cap_exceeded THEN 1 ELSE 0 END;
  expected_disposition := CASE
    WHEN NOT expected_eligible THEN 'retained_ineligible'
    WHEN expected_cap_exceeded THEN 'retained_cap'
    WHEN expected_payable <= 0 THEN 'retained_package_difference'
    WHEN expected_retained > 0 THEN 'paid_with_package_remainder'
    ELSE 'paid'
  END;

  IF NEW."sponsor_package_id" IS DISTINCT FROM sponsor."package_id"
     OR NEW."package_name_snapshot" IS DISTINCT FROM sponsor."package_name"
     OR NEW."sponsor_bonus_snapshot" IS DISTINCT FROM sponsor."sponsor_bonus"
     OR NEW."cap_enabled" IS DISTINCT FROM sponsor."cap_enabled"
     OR NEW."cap_limit" IS DISTINCT FROM sponsor."cap_limit"
     OR NEW."opening_daily_referral_count" IS DISTINCT FROM expected_opening
     OR NEW."closing_daily_referral_count" IS DISTINCT FROM expected_closing
     OR NEW."recipient_eligible" IS DISTINCT FROM expected_eligible
     OR NEW."disposition" IS DISTINCT FROM expected_disposition
     OR NEW."payable_amount" IS DISTINCT FROM expected_payable
     OR NEW."retained_amount" IS DISTINCT FROM expected_retained THEN
    RAISE EXCEPTION 'Direct Referral event does not match locked sponsor package, eligibility, or cap state.' USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO normal_match_count
  FROM "commissions" commission
  WHERE commission."id" = NEW."normal_commission_id"
    AND commission."event_key" =
        'registration:' || NEW."source_event_id" || ':direct:' || NEW."sponsor_user_id" || ':payable'
    AND commission."source_event_kind" = 'registration'
    AND commission."source_event_id" = NEW."source_event_id"
    AND commission."rule_version" = 'registration-direct-v1'
    AND commission."user_id" = NEW."sponsor_user_id"
    AND commission."type" = 'direct_referral'::"CommissionType"
    AND commission."amount" = NEW."payable_amount"
    AND commission."source_user_id" = NEW."referred_user_id"
    AND commission."is_pair_overflow" = false
    AND commission."overflow_to" IS NULL;

  IF (NEW."payable_amount" > 0 AND normal_match_count IS DISTINCT FROM 1)
     OR (NEW."payable_amount" = 0 AND NEW."normal_commission_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'Direct Referral payable commission does not match its exact event.' USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO retained_match_count
  FROM "commissions" commission
  JOIN "users" hiroma ON hiroma."id" = commission."user_id"
  WHERE commission."id" = NEW."retained_commission_id"
    AND commission."source_event_kind" = 'registration'
    AND commission."source_event_id" = NEW."source_event_id"
    AND commission."rule_version" = 'registration-direct-v1'
    AND commission."type" = 'direct_referral'::"CommissionType"
    AND commission."amount" = NEW."retained_amount"
    AND commission."source_user_id" = NEW."referred_user_id"
    AND commission."is_pair_overflow" = true
    AND commission."overflow_to" = commission."user_id"
    AND hiroma."username" = 'hiroma'
    AND hiroma."role" = 'admin'::"Role";

  IF (NEW."retained_amount" > 0 AND retained_match_count IS DISTINCT FROM 1)
     OR (NEW."retained_amount" = 0 AND NEW."retained_commission_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'Direct Referral retained commission does not match its exact event.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "direct_referral_settlement_validate_insert"
BEFORE INSERT ON "direct_referral_settlement_events"
FOR EACH ROW EXECUTE FUNCTION "validate_direct_referral_settlement_insert"();

CREATE TRIGGER "direct_referral_settlement_append_only"
BEFORE UPDATE OR DELETE ON "direct_referral_settlement_events"
FOR EACH ROW EXECUTE FUNCTION "reject_financial_history_change"();

CREATE OR REPLACE FUNCTION "verify_direct_referral_settlement_commit"()
RETURNS TRIGGER AS $$
DECLARE
  effective_closing INTEGER;
  sponsor_node_count INTEGER;
  linked_commission_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO sponsor_node_count
  FROM "binary_tree_nodes" node
  WHERE node."user_id" = NEW."referred_user_id"
    AND node."sponsor_id" = NEW."sponsor_user_id";

  IF sponsor_node_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Direct Referral event sponsor does not match the committed genealogy.' USING ERRCODE = '23514';
  END IF;

  IF NEW."disposition" <> 'retained_system_root' THEN
    SELECT CASE
             WHEN (profile."last_referral_date" AT TIME ZONE 'Asia/Manila')::date = NEW."settlement_day"
               THEN GREATEST(profile."daily_referral_count", 0)
             ELSE 0
           END::INTEGER
    INTO effective_closing
    FROM "reseller_profiles" profile
    WHERE profile."user_id" = NEW."sponsor_user_id";

    IF effective_closing IS DISTINCT FROM NEW."closing_daily_referral_count" THEN
      RAISE EXCEPTION 'Direct Referral sponsor daily counter does not match the immutable event closing state.' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO linked_commission_count
  FROM "commissions" commission
  WHERE commission."type" = 'direct_referral'::"CommissionType"
    AND commission."rule_version" = 'registration-direct-v1'
    AND commission."source_event_kind" = 'registration'
    AND commission."source_event_id" = NEW."source_event_id";

  IF linked_commission_count IS DISTINCT FROM
     ((NEW."normal_commission_id" IS NOT NULL)::INTEGER +
      (NEW."retained_commission_id" IS NOT NULL)::INTEGER) THEN
    RAISE EXCEPTION 'Direct Referral source has commissions outside its exact settlement event.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "direct_referral_settlement_verify_commit"
AFTER INSERT ON "direct_referral_settlement_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "verify_direct_referral_settlement_commit"();

CREATE OR REPLACE FUNCTION "require_direct_referral_settlement_for_registration"()
RETURNS TRIGGER AS $$
DECLARE
  event_count INTEGER;
BEGIN
  IF NEW."payment_status" <> 'paid' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO event_count
  FROM "direct_referral_settlement_events" event
  WHERE event."registration_financial_id" = NEW."id"
    AND event."source_event_id" = NEW."pin_id"
    AND event."referred_user_id" = NEW."reseller_id"
    AND event."source_allocation" = NEW."direct_referral_allocation";

  IF event_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Paid registration must commit with exactly one Direct Referral settlement event.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "registration_financials_require_direct_referral_settlement"
AFTER INSERT ON "registration_financials"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_direct_referral_settlement_for_registration"();

CREATE OR REPLACE FUNCTION "require_direct_referral_commission_event"()
RETURNS TRIGGER AS $$
DECLARE
  event_count INTEGER;
BEGIN
  IF NEW."type" <> 'direct_referral'::"CommissionType"
     OR NEW."rule_version" <> 'registration-direct-v1' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO event_count
  FROM "direct_referral_settlement_events" event
  WHERE event."source_event_id" = NEW."source_event_id"
    AND event."referred_user_id" = NEW."source_user_id"
    AND (
      (
        event."normal_commission_id" = NEW."id"
        AND event."sponsor_user_id" = NEW."user_id"
        AND event."payable_amount" = NEW."amount"
        AND NEW."is_pair_overflow" = false
        AND NEW."overflow_to" IS NULL
      )
      OR
      (
        event."retained_commission_id" = NEW."id"
        AND event."retained_amount" = NEW."amount"
        AND NEW."is_pair_overflow" = true
        AND NEW."overflow_to" = NEW."user_id"
      )
    );

  IF event_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Direct Referral commission has no exact immutable settlement event.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "commissions_require_direct_referral_event"
AFTER INSERT ON "commissions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_direct_referral_commission_event"();

COMMIT;
