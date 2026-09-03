-- Member IDs are permanent public identifiers embedded in QR codes. Their
-- allocation state must survive deletion of the user that originally held one.
CREATE TABLE IF NOT EXISTS "member_id_sequences" (
  "year" TEXT PRIMARY KEY,
  "last_sequence" INTEGER NOT NULL CHECK ("last_sequence" > 0)
);

-- Seed each yearly counter from all currently assigned IDs. Future allocations
-- update this ledger atomically instead of deriving the next value from users.
INSERT INTO "member_id_sequences" ("year", "last_sequence")
SELECT
  split_part("member_id", '-', 2) AS "year",
  MAX(split_part("member_id", '-', 3)::integer) AS "last_sequence"
FROM "users"
WHERE "member_id" ~ '^HRM-[0-9]{4}-[0-9]{6}$'
GROUP BY split_part("member_id", '-', 2)
ON CONFLICT ("year") DO UPDATE
SET "last_sequence" = GREATEST(
  "member_id_sequences"."last_sequence",
  EXCLUDED."last_sequence"
);
