CREATE TYPE "SupportRequestSource" AS ENUM ('public', 'member');
CREATE TYPE "SupportRequestCategory" AS ENUM ('suggestion', 'feedback', 'bug', 'support');
CREATE TYPE "SupportRequestStatus" AS ENUM ('new', 'reviewing', 'resolved');

CREATE TABLE "support_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "source" "SupportRequestSource" NOT NULL DEFAULT 'public',
    "category" "SupportRequestCategory" NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "SupportRequestStatus" NOT NULL DEFAULT 'new',
    "admin_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "support_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_requests_status_created_at_idx" ON "support_requests"("status", "created_at");
CREATE INDEX "support_requests_source_created_at_idx" ON "support_requests"("source", "created_at");
CREATE INDEX "support_requests_user_id_created_at_idx" ON "support_requests"("user_id", "created_at");
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
