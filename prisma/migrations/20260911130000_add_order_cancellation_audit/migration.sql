BEGIN;

ALTER TABLE "orders"
  ADD COLUMN "cancelled_at" TIMESTAMPTZ(6),
  ADD COLUMN "cancelled_by_actor_id" TEXT,
  ADD COLUMN "cancelled_by_name" VARCHAR(160),
  ADD COLUMN "cancelled_by_role" VARCHAR(40),
  ADD COLUMN "cancellation_reason" VARCHAR(500);

CREATE INDEX "orders_cancelled_at_idx" ON "orders" ("cancelled_at" DESC)
  WHERE "status" = 'cancelled'::"OrderStatus";

CREATE OR REPLACE FUNCTION protect_order_cancellation_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'cancelled'::"OrderStatus" AND (
    NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at" OR
    NEW."cancelled_by_actor_id" IS DISTINCT FROM OLD."cancelled_by_actor_id" OR
    NEW."cancelled_by_name" IS DISTINCT FROM OLD."cancelled_by_name" OR
    NEW."cancelled_by_role" IS DISTINCT FROM OLD."cancelled_by_role" OR
    NEW."cancellation_reason" IS DISTINCT FROM OLD."cancellation_reason"
  ) THEN
    RAISE EXCEPTION 'Order cancellation evidence is immutable';
  END IF;

  IF NEW."status" = 'cancelled'::"OrderStatus"
     AND OLD."status" IS DISTINCT FROM 'cancelled'::"OrderStatus"
     AND (
       NEW."cancelled_at" IS NULL OR
       NULLIF(BTRIM(NEW."cancelled_by_actor_id"), '') IS NULL OR
       NULLIF(BTRIM(NEW."cancelled_by_name"), '') IS NULL OR
       NULLIF(BTRIM(NEW."cancelled_by_role"), '') IS NULL OR
       NULLIF(BTRIM(NEW."cancellation_reason"), '') IS NULL
     ) THEN
    RAISE EXCEPTION 'Cancelled orders require complete cancellation evidence';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "orders_protect_cancellation_evidence"
BEFORE UPDATE ON "orders"
FOR EACH ROW
EXECUTE FUNCTION protect_order_cancellation_evidence();

COMMIT;
