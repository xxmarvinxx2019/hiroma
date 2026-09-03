-- Existing Upgrade PINs did not record whether their acquisition cost used
-- City or Branch pricing. Keep them null so redemption can fail safely and
-- require cancellation/regeneration instead of guessing their economics.
ALTER TABLE "pins"
ADD COLUMN "upgrade_acquisition_tier_snapshot" VARCHAR(16);

ALTER TABLE "pin_upgrade_product_snapshots"
ADD COLUMN "unit_acquisition_cost_snapshot" DECIMAL(10, 2);

ALTER TABLE "pins"
ADD CONSTRAINT "pins_upgrade_acquisition_tier_snapshot_check"
CHECK (
  "upgrade_acquisition_tier_snapshot" IS NULL
  OR "upgrade_acquisition_tier_snapshot" IN ('city', 'branch')
);
