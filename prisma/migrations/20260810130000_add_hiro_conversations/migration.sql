CREATE TYPE "HiroConversationStatus" AS ENUM ('active', 'closed');
CREATE TYPE "HiroMessageRole" AS ENUM ('user', 'hiro', 'system');

CREATE TABLE "hiro_conversations" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "status" "HiroConversationStatus" NOT NULL DEFAULT 'active',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_activity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMP(3),
  "close_reason" TEXT,
  CONSTRAINT "hiro_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hiro_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "hiro_messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "role" "HiroMessageRole" NOT NULL,
  "text" TEXT NOT NULL,
  "intent" TEXT,
  "links" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hiro_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hiro_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "hiro_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "hiro_conversations_user_id_status_last_activity_idx" ON "hiro_conversations"("user_id", "status", "last_activity");
CREATE INDEX "hiro_messages_conversation_id_created_at_idx" ON "hiro_messages"("conversation_id", "created_at");
