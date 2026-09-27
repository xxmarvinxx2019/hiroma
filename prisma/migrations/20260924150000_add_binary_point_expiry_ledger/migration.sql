BEGIN;

INSERT INTO "system_settings" ("id", "key", "value", "updated_at")
VALUES (gen_random_uuid(), 'binary_point_expiry_years', '3', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Freeze Package Binary writers while the current aggregate carryover is
-- converted to dated lots. This prevents a registration on the previous app
-- version from adding points between the snapshot and deployment cutover.
LOCK TABLE "binary_pair_events", "binary_settlement_events", "reseller_profiles"
  IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "binary_point_lots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recipient_user_id" TEXT NOT NULL,
  "source_user_id" TEXT NOT NULL,
  "source_kind" VARCHAR(40) NOT NULL,
  "source_event_id" VARCHAR(255) NOT NULL,
  "leg" VARCHAR(5) NOT NULL,
  "original_points" INTEGER NOT NULL,
  "remaining_points" INTEGER NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "expiry_years" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "binary_point_lots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "binary_point_lots_recipient_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "binary_point_lots_source_fkey" FOREIGN KEY ("source_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "binary_point_lots_leg_check" CHECK ("leg" IN ('left','right')),
  CONSTRAINT "binary_point_lots_points_check" CHECK ("original_points" > 0 AND "remaining_points" >= 0 AND "remaining_points" <= "original_points"),
  CONSTRAINT "binary_point_lots_expiry_check" CHECK ("expiry_years" BETWEEN 1 AND 20 AND "expires_at" > "generated_at")
);

CREATE UNIQUE INDEX "binary_point_lots_source_recipient_leg_key"
  ON "binary_point_lots"("source_kind","source_event_id","recipient_user_id","leg");
CREATE INDEX "binary_point_lots_recipient_leg_generated_idx"
  ON "binary_point_lots"("recipient_user_id","leg","generated_at");
CREATE INDEX "binary_point_lots_expiry_remaining_idx"
  ON "binary_point_lots"("expires_at","remaining_points");

CREATE TABLE "binary_point_consumptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "point_lot_id" UUID NOT NULL,
  "binary_pair_event_id" UUID NOT NULL,
  "points" INTEGER NOT NULL,
  "consumed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "binary_point_consumptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "binary_point_consumptions_lot_fkey" FOREIGN KEY ("point_lot_id") REFERENCES "binary_point_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "binary_point_consumptions_event_fkey" FOREIGN KEY ("binary_pair_event_id") REFERENCES "binary_pair_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "binary_point_consumptions_points_check" CHECK ("points" > 0)
);
CREATE UNIQUE INDEX "binary_point_consumptions_lot_event_key"
  ON "binary_point_consumptions"("point_lot_id","binary_pair_event_id");
CREATE INDEX "binary_point_consumptions_event_idx"
  ON "binary_point_consumptions"("binary_pair_event_id");

CREATE TABLE "binary_point_expirations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "point_lot_id" UUID NOT NULL,
  "recipient_user_id" TEXT NOT NULL,
  "leg" VARCHAR(5) NOT NULL,
  "points" INTEGER NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL,
  "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
  "expired_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiry_years" INTEGER NOT NULL,
  CONSTRAINT "binary_point_expirations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "binary_point_expirations_lot_key" UNIQUE ("point_lot_id"),
  CONSTRAINT "binary_point_expirations_lot_fkey" FOREIGN KEY ("point_lot_id") REFERENCES "binary_point_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "binary_point_expirations_recipient_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "binary_point_expirations_leg_check" CHECK ("leg" IN ('left','right')),
  CONSTRAINT "binary_point_expirations_points_check" CHECK ("points" > 0 AND "expiry_years" BETWEEN 1 AND 20)
);
CREATE INDEX "binary_point_expirations_recipient_expired_idx"
  ON "binary_point_expirations"("recipient_user_id","expired_at");
CREATE INDEX "binary_point_expirations_expired_idx"
  ON "binary_point_expirations"("expired_at");

-- Existing aggregate balances have no recoverable generation timestamps. Give
-- them a transparent new three-year term from migration instead of fabricating
-- historical dates or expiring members' balances immediately.
INSERT INTO "binary_point_lots" (
  "recipient_user_id","source_user_id","source_kind","source_event_id","leg",
  "original_points","remaining_points","generated_at","expires_at","expiry_years"
)
SELECT profile."user_id", profile."user_id", 'legacy_backfill',
       'legacy-left-' || profile."user_id", 'left', profile."left_points",
       profile."left_points", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '3 years', 3
FROM "reseller_profiles" profile
WHERE COALESCE(profile."left_points",0) > 0
UNION ALL
SELECT profile."user_id", profile."user_id", 'legacy_backfill',
       'legacy-right-' || profile."user_id", 'right', profile."right_points",
       profile."right_points", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '3 years', 3
FROM "reseller_profiles" profile
WHERE COALESCE(profile."right_points",0) > 0;

DO $$
DECLARE
  mismatches INTEGER;
BEGIN
  SELECT COUNT(*) INTO mismatches
  FROM "reseller_profiles" profile
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM("remaining_points") FILTER (WHERE "leg"='left'),0)::INTEGER left_points,
           COALESCE(SUM("remaining_points") FILTER (WHERE "leg"='right'),0)::INTEGER right_points
    FROM "binary_point_lots" lot WHERE lot."recipient_user_id"=profile."user_id"
  ) lots ON true
  WHERE COALESCE(profile."left_points",0)<>lots.left_points
     OR COALESCE(profile."right_points",0)<>lots.right_points;
  IF mismatches<>0 THEN
    RAISE EXCEPTION 'Binary point lot backfill does not reconcile for % member(s).', mismatches USING ERRCODE='23514';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "protect_binary_point_lot"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Binary point lots are append-only.' USING ERRCODE='23514';
  END IF;
  IF OLD."recipient_user_id" IS DISTINCT FROM NEW."recipient_user_id"
     OR OLD."source_user_id" IS DISTINCT FROM NEW."source_user_id"
     OR OLD."source_kind" IS DISTINCT FROM NEW."source_kind"
     OR OLD."source_event_id" IS DISTINCT FROM NEW."source_event_id"
     OR OLD."leg" IS DISTINCT FROM NEW."leg"
     OR OLD."original_points" IS DISTINCT FROM NEW."original_points"
     OR OLD."generated_at" IS DISTINCT FROM NEW."generated_at"
     OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
     OR NEW."remaining_points" > OLD."remaining_points" THEN
    RAISE EXCEPTION 'Binary point lot identity or consumed balance is immutable.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "binary_point_lots_protect"
BEFORE UPDATE OR DELETE ON "binary_point_lots"
FOR EACH ROW EXECUTE FUNCTION "protect_binary_point_lot"();

CREATE OR REPLACE FUNCTION "protect_binary_point_evidence"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Binary point consumption and expiration evidence is append-only.' USING ERRCODE='23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "binary_point_consumptions_protect"
BEFORE UPDATE OR DELETE ON "binary_point_consumptions"
FOR EACH ROW EXECUTE FUNCTION "protect_binary_point_evidence"();
CREATE TRIGGER "binary_point_expirations_protect"
BEFORE UPDATE OR DELETE ON "binary_point_expirations"
FOR EACH ROW EXECUTE FUNCTION "protect_binary_point_evidence"();

CREATE OR REPLACE FUNCTION "validate_binary_point_lot_balance"()
RETURNS TRIGGER AS $$
DECLARE
  consumed INTEGER;
  expired INTEGER;
BEGIN
  SELECT COALESCE(SUM(points),0)::INTEGER INTO consumed
  FROM "binary_point_consumptions" WHERE "point_lot_id"=NEW."id";
  SELECT COALESCE(SUM(points),0)::INTEGER INTO expired
  FROM "binary_point_expirations" WHERE "point_lot_id"=NEW."id";
  IF NEW."original_points" - NEW."remaining_points" <> consumed + expired THEN
    RAISE EXCEPTION 'Binary point lot does not reconcile to consumption and expiration evidence.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "binary_point_lots_balance_check"
AFTER INSERT OR UPDATE ON "binary_point_lots"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_binary_point_lot_balance"();

CREATE OR REPLACE FUNCTION "validate_binary_point_evidence_balance"()
RETURNS TRIGGER AS $$
DECLARE
  lot "binary_point_lots"%ROWTYPE;
  consumed INTEGER;
  expired INTEGER;
BEGIN
  SELECT * INTO lot FROM "binary_point_lots" WHERE "id"=NEW."point_lot_id";
  SELECT COALESCE(SUM(points),0)::INTEGER INTO consumed
  FROM "binary_point_consumptions" WHERE "point_lot_id"=NEW."point_lot_id";
  SELECT COALESCE(SUM(points),0)::INTEGER INTO expired
  FROM "binary_point_expirations" WHERE "point_lot_id"=NEW."point_lot_id";
  IF lot."id" IS NULL OR lot."original_points" - lot."remaining_points" <> consumed + expired THEN
    RAISE EXCEPTION 'Binary point evidence does not reconcile to its point lot.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "binary_point_consumptions_balance_check"
AFTER INSERT ON "binary_point_consumptions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_binary_point_evidence_balance"();
CREATE CONSTRAINT TRIGGER "binary_point_expirations_balance_check"
AFTER INSERT ON "binary_point_expirations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_binary_point_evidence_balance"();

REVOKE ALL ON FUNCTION "protect_binary_point_lot"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "protect_binary_point_evidence"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "validate_binary_point_lot_balance"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "validate_binary_point_evidence_balance"() FROM PUBLIC;

COMMIT;
