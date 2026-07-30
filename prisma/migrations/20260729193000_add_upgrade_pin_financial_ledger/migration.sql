-- Upgrade PINs are distinct from normal registration PINs. Their monetary
-- value is snapshotted at issuance, so later package-price edits cannot alter
-- a City Distributor's already purchased upgrade PIN.
ALTER TABLE "pins"
  ADD COLUMN "pin_type" VARCHAR NOT NULL DEFAULT 'registration',
  ADD COLUMN "upgrade_from_package_id" UUID,
  ADD COLUMN "pin_allocation_snapshot" DECIMAL(12,2),
  ADD COLUMN "upgrade_customer_payment_snapshot" DECIMAL(12,2),
  ADD COLUMN "upgrade_reseller_value_snapshot" DECIMAL(12,2),
  ADD COLUMN "upgrade_acquisition_cost_snapshot" DECIMAL(12,2),
  ADD COLUMN "upgrade_direct_allocation_snapshot" DECIMAL(12,2),
  ADD COLUMN "upgrade_binary_allocation_snapshot" DECIMAL(12,2),
  ADD COLUMN "upgrade_points_difference_snapshot" INTEGER;

CREATE INDEX "pins_city_dist_id_pin_type_status_idx"
  ON "pins"("city_dist_id", "pin_type", "status");

CREATE TABLE "upgrade_financials" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "upgrade_pin_id" UUID NOT NULL,
  "city_dist_id" UUID NOT NULL,
  "reseller_id" UUID NOT NULL,
  "from_package_id" UUID NOT NULL,
  "to_package_id" UUID NOT NULL,
  "customer_payment" DECIMAL(12,2) NOT NULL,
  "product_acquisition_cost" DECIMAL(12,2) NOT NULL,
  "reseller_value" DECIMAL(12,2) NOT NULL,
  "pin_allocation" DECIMAL(12,2) NOT NULL,
  "registration_profit" DECIMAL(12,2) NOT NULL,
  "direct_referral_allocation" DECIMAL(12,2) NOT NULL,
  "direct_referral_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "direct_referral_retained" DECIMAL(12,2) NOT NULL,
  "binary_commission_allocation" DECIMAL(12,2) NOT NULL,
  "binary_points_difference" INTEGER NOT NULL,
  "from_package_name_snapshot" TEXT NOT NULL,
  "to_package_name_snapshot" TEXT NOT NULL,
  "allocation_snapshot_source" VARCHAR NOT NULL DEFAULT 'upgrade_pin_snapshot',
  "payment_status" VARCHAR NOT NULL DEFAULT 'paid',
  "paid_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "upgrade_financials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "upgrade_financials_upgrade_pin_id_key" UNIQUE ("upgrade_pin_id")
);

CREATE INDEX "upgrade_financials_city_dist_id_created_at_idx"
  ON "upgrade_financials"("city_dist_id", "created_at");
CREATE INDEX "upgrade_financials_reseller_id_created_at_idx"
  ON "upgrade_financials"("reseller_id", "created_at");

ALTER TABLE "binary_reserve_lots"
  ALTER COLUMN "registration_financial_id" DROP NOT NULL,
  ADD COLUMN "upgrade_financial_id" UUID;
CREATE UNIQUE INDEX "binary_reserve_lots_upgrade_financial_id_key"
  ON "binary_reserve_lots"("upgrade_financial_id");