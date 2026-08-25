CREATE TABLE "address_geocode_cache" (
  "id" UUID NOT NULL,
  "address_hash" VARCHAR NOT NULL,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "provider" VARCHAR NOT NULL DEFAULT 'nominatim',
  "result_label" TEXT,
  "lookup_status" VARCHAR NOT NULL DEFAULT 'found',
  "last_lookup_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "address_geocode_cache_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "address_geocode_cache_address_hash_key" UNIQUE ("address_hash"),
  CONSTRAINT "address_geocode_cache_coordinates_pair_check"
    CHECK (("latitude" IS NULL) = ("longitude" IS NULL))
);

CREATE INDEX "address_geocode_cache_lookup_status_last_lookup_at_idx"
  ON "address_geocode_cache" ("lookup_status", "last_lookup_at");
