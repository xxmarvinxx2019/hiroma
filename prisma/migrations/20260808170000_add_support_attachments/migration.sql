CREATE TABLE "support_attachments" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "support_attachments_request_id_idx" ON "support_attachments"("request_id");
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "support_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
