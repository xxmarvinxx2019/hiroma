ALTER TABLE "distributor_profiles"
  ADD COLUMN "fulfillment_latitude" DECIMAL(10,7),
  ADD COLUMN "fulfillment_longitude" DECIMAL(10,7);

ALTER TABLE "distributor_profiles"
  ADD CONSTRAINT "distributor_profiles_fulfillment_latitude_check"
    CHECK ("fulfillment_latitude" IS NULL OR "fulfillment_latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "distributor_profiles_fulfillment_longitude_check"
    CHECK ("fulfillment_longitude" IS NULL OR "fulfillment_longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "distributor_profiles_fulfillment_coordinates_pair_check"
    CHECK (("fulfillment_latitude" IS NULL) = ("fulfillment_longitude" IS NULL));
