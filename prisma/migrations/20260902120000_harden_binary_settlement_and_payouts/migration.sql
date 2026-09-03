-- Protect every registration/upgrade volume application independently from
-- commission-row idempotency. Historical pair events cannot be backfilled with
-- their PIN source id, so the new column remains nullable for legacy rows.
BEGIN;

DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'Hiroma financial migrations require PostgreSQL 15 or newer.';
  END IF;
END $$;

-- Fixed alphabetical order across the financial migration series. This blocks
-- concurrent settlement, reserve, and payout writes until all new constraints
-- and triggers are installed or the whole migration rolls back.
LOCK TABLE
  "binary_pair_events",
  "binary_payout_consumptions",
  "binary_reserve_consumptions",
  "binary_reserve_lots",
  "commissions",
  "direct_referral_payout_consumptions",
  "payouts",
  "product_binary_payout_consumptions"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "binary_settlement_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_kind" VARCHAR NOT NULL,
  "source_event_id" VARCHAR(255) NOT NULL,
  "source_user_id" TEXT NOT NULL,
  "source_points" INTEGER NOT NULL,
  "parent_node_id" TEXT NOT NULL,
  "source_leg" VARCHAR NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "binary_settlement_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "binary_settlement_events_source_check"
    CHECK ("source_kind" IN ('registration', 'upgrade')),
  CONSTRAINT "binary_settlement_events_points_check"
    CHECK ("source_points" > 0),
  CONSTRAINT "binary_settlement_events_leg_check"
    CHECK ("source_leg" IN ('left', 'right'))
);

CREATE UNIQUE INDEX "binary_settlement_events_source_kind_source_event_id_key"
ON "binary_settlement_events" ("source_kind", "source_event_id");

CREATE INDEX "binary_settlement_events_source_user_id_created_at_idx"
ON "binary_settlement_events" ("source_user_id", "created_at");

ALTER TABLE "binary_pair_events"
ADD COLUMN "source_event_id" VARCHAR(255);

CREATE UNIQUE INDEX "binary_pair_events_source_kind_source_event_id_recipient_user_id_key"
ON "binary_pair_events" ("source_kind", "source_event_id", "recipient_user_id");

-- Member reserve funds only member-payable package-binary commissions.
-- Cap/inactive flashouts remain immutable retained-income audit rows, but do
-- not consume reserve and are never made spendable by the application.
CREATE OR REPLACE FUNCTION "consume_binary_reserve"()
RETURNS TRIGGER AS $$
DECLARE
  remaining DECIMAL(12,2);
  available DECIMAL(12,2);
  lot RECORD;
  consumed DECIMAL(12,2);
BEGIN
  IF NEW."type" <> 'binary_pairing'
     OR NEW."amount" <= 0
     OR NEW."is_pair_overflow" = true THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('binary-reserve-funding'));

  IF EXISTS (
    SELECT 1
    FROM "binary_reserve_consumptions"
    WHERE "commission_id" = NEW."id"
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM("remaining_amount"), 0)
  INTO available
  FROM "binary_reserve_lots"
  WHERE "remaining_amount" > 0;

  IF available < NEW."amount" THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Binary commission reserve is insufficient.',
      DETAIL = format(
        'commission_id=%s required=%s available=%s',
        NEW."id",
        NEW."amount",
        available
      );
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

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'Binary commission reserve changed during consumption.',
        DETAIL = format(
          'commission_id=%s remaining_required=%s',
          NEW."id",
          remaining
        );
    END IF;

    consumed := LEAST(remaining, lot."remaining_amount");
    UPDATE "binary_reserve_lots"
    SET "remaining_amount" = "remaining_amount" - consumed
    WHERE "id" = lot."id";

    INSERT INTO "binary_reserve_consumptions" (
      "reserve_lot_id",
      "commission_id",
      "amount",
      "is_unfunded",
      "consumed_at"
    )
    VALUES (
      lot."id",
      NEW."id",
      consumed,
      false,
      NEW."created_at"
    );

    remaining := remaining - consumed;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Refuse to claim that historical or future payouts are allocated when their
-- direct + package-binary + product-binary payable evidence does not equal the
-- exact payout amount. Unsupported legacy/manual wallet credits require an
-- explicit reconciliation instead of silently leaving an untraceable payout.
DO $$
DECLARE
  mismatched_payouts BIGINT;
  mismatched_amount DECIMAL(12,2);
BEGIN
  WITH allocation AS (
    SELECT
      p."id",
      p."amount",
      COALESCE((
        SELECT SUM(x."amount")
        FROM (
          SELECT c."amount"
          FROM "direct_referral_payout_consumptions" c
          WHERE c."payout_id" = p."id"
          UNION ALL
          SELECT c."amount"
          FROM "binary_payout_consumptions" c
          WHERE c."payout_id" = p."id"
          UNION ALL
          SELECT c."amount"
          FROM "product_binary_payout_consumptions" c
          WHERE c."payout_id" = p."id"
        ) x
      ), 0) AS allocated
    FROM "payouts" p
    WHERE p."status" IN ('approved', 'released')
  )
  SELECT COUNT(*), COALESCE(SUM(ABS("amount" - allocated)), 0)
  INTO mismatched_payouts, mismatched_amount
  FROM allocation
  WHERE allocated <> "amount";

  IF mismatched_payouts > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Historical payouts require full source-allocation reconciliation.',
      DETAIL = format(
        'mismatched_payouts=%s mismatched_amount=%s',
        mismatched_payouts,
        mismatched_amount
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "require_fully_allocated_approved_payout"()
RETURNS TRIGGER AS $$
DECLARE
  allocated DECIMAL(12,2);
BEGIN
  IF NEW."status" IN ('approved', 'released')
     AND (
       TG_OP = 'INSERT'
       OR OLD."status" IS DISTINCT FROM NEW."status"
     ) THEN
    SELECT COALESCE(SUM(x."amount"), 0)
    INTO allocated
    FROM (
      SELECT c."amount"
      FROM "direct_referral_payout_consumptions" c
      WHERE c."payout_id" = NEW."id"
      UNION ALL
      SELECT c."amount"
      FROM "binary_payout_consumptions" c
      WHERE c."payout_id" = NEW."id"
      UNION ALL
      SELECT c."amount"
      FROM "product_binary_payout_consumptions" c
      WHERE c."payout_id" = NEW."id"
    ) x;

    IF allocated <> NEW."amount" THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'Payout is not fully backed by payable commission lots.',
        DETAIL = format(
          'payout_id=%s required=%s allocated=%s',
          NEW."id",
          NEW."amount",
          allocated
        );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- PostgreSQL executes same-event triggers in name order. This verifier must
-- run after direct, zz_binary, and zzz_product-binary allocation triggers.
DROP TRIGGER IF EXISTS "zzzz_payouts_require_full_source_allocation" ON "payouts";
CREATE TRIGGER "zzzz_payouts_require_full_source_allocation"
AFTER INSERT OR UPDATE OF "status" ON "payouts"
FOR EACH ROW EXECUTE FUNCTION "require_fully_allocated_approved_payout"();

COMMIT;
