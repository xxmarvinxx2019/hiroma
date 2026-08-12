CREATE TABLE "reseller_deactivation_events" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "reseller_id" TEXT NOT NULL REFERENCES "users"("id"),
  "processed_by" TEXT NOT NULL REFERENCES "users"("id"),
  "flushed_points" INTEGER NOT NULL,
  "points_value" DECIMAL(12,2) NOT NULL,
  "wallet_value" DECIMAL(12,2) NOT NULL,
  "total_flushed" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reseller_deactivation_values_check"
    CHECK (
      "flushed_points" >= 0
      AND "points_value" >= 0
      AND "wallet_value" >= 0
      AND "total_flushed" = "points_value" + "wallet_value"
    )
);

CREATE INDEX "reseller_deactivation_events_reseller_id_created_at_idx"
ON "reseller_deactivation_events" ("reseller_id", "created_at");
