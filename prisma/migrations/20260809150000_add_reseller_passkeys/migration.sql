-- Passkeys are opt-in and disabled for every existing account by default.
ALTER TABLE "users" ADD COLUMN "passkey_test_enabled" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "passkey_credentials" ("id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "credential_id" TEXT NOT NULL, "public_key" BYTEA NOT NULL, "counter" BIGINT NOT NULL DEFAULT 0, "transports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "device_name" TEXT NOT NULL, "device_type" TEXT, "backed_up" BOOLEAN NOT NULL DEFAULT false, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "last_used_at" TIMESTAMP(3), CONSTRAINT "passkey_credentials_pkey" PRIMARY KEY ("id"), CONSTRAINT "passkey_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "passkey_credentials_credential_id_key" ON "passkey_credentials"("credential_id");
CREATE  INDEX "passkey_credentials_user_id_idx" ON "passkey_credentials"("user_id");
CREATE TABLE "passkey_challenges" ("id" TEXT NOT NULL, "user_id" TEXT, "challenge" TEXT NOT NULL, "purpose" TEXT NOT NULL, "device_name" TEXT, "expires_at" TIMESTAMP(3) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "passkey_challenges_pkey" PRIMARY KEY ("id"), CONSTRAINT "passkey_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "passkey_challenges_user_id_idx" ON "passkey_challenges"("user_id");
CREATE INDEX "passkey_challenges_expires_at_idx" ON "passkey_challenges"("expires_at");
