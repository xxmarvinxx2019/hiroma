ALTER TABLE "users"
  ADD COLUMN "street_address" TEXT,
  ADD COLUMN "region_code" TEXT,
  ADD COLUMN "region_name" TEXT,
  ADD COLUMN "province_code" TEXT,
  ADD COLUMN "province_name" TEXT,
  ADD COLUMN "city_muni_code" TEXT,
  ADD COLUMN "city_muni_name" TEXT,
  ADD COLUMN "barangay_code" TEXT,
  ADD COLUMN "barangay_name" TEXT;

ALTER TABLE "orders"
  ADD COLUMN "market_region_code" TEXT,
  ADD COLUMN "market_region_name" TEXT,
  ADD COLUMN "market_province_code" TEXT,
  ADD COLUMN "market_province_name" TEXT,
  ADD COLUMN "market_city_muni_code" TEXT,
  ADD COLUMN "market_city_muni_name" TEXT,
  ADD COLUMN "market_zip_code" TEXT,
  ADD COLUMN "market_location_source" TEXT,
  ADD COLUMN "fulfillment_region_code" TEXT,
  ADD COLUMN "fulfillment_region_name" TEXT,
  ADD COLUMN "fulfillment_province_code" TEXT,
  ADD COLUMN "fulfillment_province_name" TEXT,
  ADD COLUMN "fulfillment_city_muni_code" TEXT,
  ADD COLUMN "fulfillment_city_muni_name" TEXT,
  ADD COLUMN "fulfillment_outlet_name" TEXT;

CREATE INDEX "users_market_location_idx"
  ON "users" ("region_code", "province_code", "city_muni_code")
  WHERE "role" = 'reseller';

CREATE INDEX "orders_market_location_idx"
  ON "orders" ("market_region_code", "market_province_code", "market_city_muni_code");

CREATE OR REPLACE FUNCTION snapshot_order_geography()
RETURNS TRIGGER AS $$
DECLARE
  buyer_row "users"%ROWTYPE;
  seller_profile "distributor_profiles"%ROWTYPE;
BEGIN
  SELECT * INTO buyer_row FROM "users" WHERE "id" = NEW."buyer_id";
  SELECT * INTO seller_profile FROM "distributor_profiles" WHERE "user_id" = NEW."seller_id";

  IF buyer_row."role" = 'reseller' THEN
    NEW."market_region_code" := COALESCE(NEW."market_region_code", buyer_row."region_code");
    NEW."market_region_name" := COALESCE(NEW."market_region_name", buyer_row."region_name");
    NEW."market_province_code" := COALESCE(NEW."market_province_code", buyer_row."province_code");
    NEW."market_province_name" := COALESCE(NEW."market_province_name", buyer_row."province_name");
    NEW."market_city_muni_code" := COALESCE(NEW."market_city_muni_code", buyer_row."city_muni_code");
    NEW."market_city_muni_name" := COALESCE(NEW."market_city_muni_name", buyer_row."city_muni_name");
    NEW."market_zip_code" := COALESCE(NEW."market_zip_code", buyer_row."zip_code");
    NEW."market_location_source" := COALESCE(NEW."market_location_source", 'registered_address');
  END IF;

  IF seller_profile."id" IS NOT NULL THEN
    NEW."fulfillment_region_code" := COALESCE(NEW."fulfillment_region_code", seller_profile."region_code");
    NEW."fulfillment_region_name" := COALESCE(NEW."fulfillment_region_name", seller_profile."region_name");
    NEW."fulfillment_province_code" := COALESCE(NEW."fulfillment_province_code", seller_profile."province_code");
    NEW."fulfillment_province_name" := COALESCE(NEW."fulfillment_province_name", seller_profile."province_name");
    NEW."fulfillment_city_muni_code" := COALESCE(NEW."fulfillment_city_muni_code", seller_profile."city_muni_code");
    NEW."fulfillment_city_muni_name" := COALESCE(NEW."fulfillment_city_muni_name", seller_profile."city_muni_name");
    NEW."fulfillment_outlet_name" := COALESCE(NEW."fulfillment_outlet_name", seller_profile."fulfillment_outlet_name");
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "orders_snapshot_geography_before_insert"
BEFORE INSERT ON "orders"
FOR EACH ROW EXECUTE FUNCTION snapshot_order_geography();
