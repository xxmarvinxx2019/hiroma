CREATE TABLE "order_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "order_id" TEXT NOT NULL,
  "sender_id" TEXT NOT NULL, "sender_name" VARCHAR(160) NOT NULL,
  "sender_role" VARCHAR(40) NOT NULL, "message" VARCHAR(2000) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_messages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "order_messages_nonblank_check" CHECK (length(btrim("message")) >= 1)
);
CREATE INDEX "order_messages_order_id_created_at_idx" ON "order_messages"("order_id", "created_at");

CREATE OR REPLACE FUNCTION enforce_order_message_participants() RETURNS TRIGGER AS $$
DECLARE source_order "orders"%ROWTYPE;
BEGIN
  SELECT * INTO source_order FROM "orders" WHERE "id" = NEW."order_id" FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order does not exist'; END IF;
  IF source_order."status" IN ('delivered', 'cancelled') THEN RAISE EXCEPTION 'Order conversation is closed'; END IF;
  IF NEW."sender_id" <> source_order."buyer_id" AND NEW."sender_id" <> source_order."seller_id"
     AND NOT EXISTS (SELECT 1 FROM "staff_profiles" WHERE "user_id" = NEW."sender_id" AND "owner_id" IN (source_order."buyer_id", source_order."seller_id") AND "is_active" = TRUE)
  THEN RAISE EXCEPTION 'Sender is not an order participant'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "order_messages_participant_guard" BEFORE INSERT ON "order_messages"
FOR EACH ROW EXECUTE FUNCTION enforce_order_message_participants();

CREATE OR REPLACE FUNCTION reject_order_message_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Order message history is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "order_messages_immutable_guard" BEFORE UPDATE OR DELETE ON "order_messages"
FOR EACH ROW EXECUTE FUNCTION reject_order_message_mutation();
