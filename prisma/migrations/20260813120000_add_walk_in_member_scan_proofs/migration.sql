CREATE TABLE "walk_in_member_scan_proofs" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "token_hash" VARCHAR(64) NOT NULL,
  "reseller_id" TEXT NOT NULL,
  "distributor_id" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "walk_in_member_scan_proofs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "walk_in_member_scan_proofs_reseller_id_fkey"
    FOREIGN KEY ("reseller_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "walk_in_member_scan_proofs_distributor_id_fkey"
    FOREIGN KEY ("distributor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "walk_in_member_scan_proofs_token_hash_key"
ON "walk_in_member_scan_proofs"("token_hash");

CREATE INDEX "walk_in_member_scan_proofs_distributor_id_expires_at_idx"
ON "walk_in_member_scan_proofs"("distributor_id", "expires_at");

CREATE INDEX "walk_in_member_scan_proofs_expires_at_idx"
ON "walk_in_member_scan_proofs"("expires_at");
