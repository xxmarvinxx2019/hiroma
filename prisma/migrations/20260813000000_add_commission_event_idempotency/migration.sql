ALTER TABLE "commissions"
ADD COLUMN "event_key" VARCHAR(255);

CREATE UNIQUE INDEX "commissions_event_key_key"
ON "commissions" ("event_key");
