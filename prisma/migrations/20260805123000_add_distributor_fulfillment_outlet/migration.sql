ALTER TABLE "distributor_profiles"
  ADD COLUMN "fulfillment_outlet_name" TEXT,
  ADD COLUMN "fulfillment_outlet_address" TEXT,
  ADD COLUMN "fulfillment_outlet_region_code" TEXT,
  ADD COLUMN "fulfillment_outlet_region_name" TEXT,
  ADD COLUMN "fulfillment_outlet_province_code" TEXT,
  ADD COLUMN "fulfillment_outlet_province_name" TEXT,
  ADD COLUMN "fulfillment_outlet_city_muni_code" TEXT,
  ADD COLUMN "fulfillment_outlet_city_muni_name" TEXT,
  ADD COLUMN "fulfillment_outlet_barangay_code" TEXT,
  ADD COLUMN "fulfillment_outlet_barangay_name" TEXT,
  ADD COLUMN "fulfillment_outlet_zip_code" TEXT;
