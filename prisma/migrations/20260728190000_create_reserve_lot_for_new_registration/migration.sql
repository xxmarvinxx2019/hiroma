-- Keep the reserve ledger complete for every future registration.
-- The unique registration link makes this safe if a registration is retried.
CREATE OR REPLACE FUNCTION "create_binary_reserve_lot_for_registration"()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "binary_reserve_lots" (
    "registration_financial_id",
    "original_amount",
    "remaining_amount",
    "snapshot_source",
    "allocated_at"
  ) VALUES (
    NEW."id",
    NEW."binary_commission_allocation",
    NEW."binary_commission_allocation",
    NEW."allocation_snapshot_source",
    NEW."created_at"
  )
  ON CONFLICT ("registration_financial_id") DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "registration_financials_create_binary_reserve_lot" ON "registration_financials";
CREATE TRIGGER "registration_financials_create_binary_reserve_lot"
AFTER INSERT ON "registration_financials"
FOR EACH ROW EXECUTE FUNCTION "create_binary_reserve_lot_for_registration"();
