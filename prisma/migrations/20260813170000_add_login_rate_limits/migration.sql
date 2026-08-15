CREATE TABLE "login_rate_limits" (
  "bucket_key" VARCHAR(80) NOT NULL,
  "window_start" TIMESTAMPTZ(6) NOT NULL,
  "request_count" INTEGER NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "login_rate_limits_pkey" PRIMARY KEY ("bucket_key", "window_start"),
  CONSTRAINT "login_rate_limits_request_count_check" CHECK ("request_count" BETWEEN 1 AND 1001)
);

CREATE INDEX "login_rate_limits_expires_at_idx"
ON "login_rate_limits"("expires_at");
