CREATE TYPE "SupportRequestPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

ALTER TABLE "support_requests"
  ADD COLUMN "ticket_number" TEXT,
  ADD COLUMN "priority" "SupportRequestPriority" NOT NULL DEFAULT 'normal',
  ADD COLUMN "assigned_to" TEXT;

UPDATE "support_requests"
SET "ticket_number" = 'SUP-LEGACY-' || upper(substr(replace("id", '-', ''), 1, 8))
WHERE "ticket_number" IS NULL;

ALTER TABLE "support_requests" ALTER COLUMN "ticket_number" SET NOT NULL;
CREATE UNIQUE INDEX "support_requests_ticket_number_key" ON "support_requests"("ticket_number");
CREATE INDEX "support_requests_assigned_to_status_idx" ON "support_requests"("assigned_to", "status");
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "support_messages" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "author_id" TEXT,
  "author_name" TEXT NOT NULL,
  "author_role" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_messages_request_id_created_at_idx" ON "support_messages"("request_id", "created_at");
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "support_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
