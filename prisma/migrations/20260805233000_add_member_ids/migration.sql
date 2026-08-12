-- Public, human-readable ID for the digital member card. The internal users.id
-- UUID remains the database key; member_id is a separate permanent identifier.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "member_id" TEXT;

-- Give every existing account an ID based on its original registration year.
-- The sequence is deterministic within each year, ordered by registration time.
WITH numbered_users AS (
  SELECT
    id,
    format(
      'HRM-%s-%s',
      to_char(created_at AT TIME ZONE 'Asia/Manila', 'YYYY'),
      lpad(
        row_number() OVER (
          PARTITION BY to_char(created_at AT TIME ZONE 'Asia/Manila', 'YYYY')
          ORDER BY created_at, id
        )::text,
        6,
        '0'
      )
    ) AS generated_member_id
  FROM "users"
  WHERE member_id IS NULL
)
UPDATE "users" AS users
SET member_id = numbered_users.generated_member_id
FROM numbered_users
WHERE users.id = numbered_users.id;

ALTER TABLE "users"
  ALTER COLUMN "member_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "users_member_id_key"
  ON "users" ("member_id");
