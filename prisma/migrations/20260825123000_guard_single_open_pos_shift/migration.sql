ALTER TABLE "pos_shifts" ADD COLUMN "active_terminal_key" UUID;
CREATE UNIQUE INDEX "pos_shifts_active_terminal_key_key" ON "pos_shifts"("active_terminal_key");
UPDATE "pos_shifts" SET "active_terminal_key" = "terminal_id" WHERE "status" = 'open';
