ALTER TABLE "support_requests"
ADD COLUMN "submitter_fingerprint" TEXT,
ADD COLUMN "email_fingerprint" TEXT;

CREATE INDEX "support_requests_submitter_fingerprint_created_at_idx"
ON "support_requests"("submitter_fingerprint", "created_at");

CREATE INDEX "support_requests_email_fingerprint_created_at_idx"
ON "support_requests"("email_fingerprint", "created_at");

CREATE TABLE "support_captcha_challenges" (
  "id" UUID NOT NULL,
  "answer_digest" TEXT NOT NULL,
  "client_fingerprint" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_captcha_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_captcha_challenges_client_fingerprint_created_at_idx"
ON "support_captcha_challenges"("client_fingerprint", "created_at");

CREATE INDEX "support_captcha_challenges_expires_at_idx"
ON "support_captcha_challenges"("expires_at");
