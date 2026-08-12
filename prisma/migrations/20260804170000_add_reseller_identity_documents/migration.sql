-- Store only a one-way HMAC of a valid-ID number. The original number is never persisted.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "identity_document_type" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "identity_document_hash" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "users_identity_document_hash_idx"
  ON "users" ("identity_document_hash")
  WHERE "identity_document_hash" IS NOT NULL;
