CREATE TABLE "support_typing" (
  "request_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  PRIMARY KEY ("request_id", "actor_id"),
  FOREIGN KEY ("request_id") REFERENCES "support_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
