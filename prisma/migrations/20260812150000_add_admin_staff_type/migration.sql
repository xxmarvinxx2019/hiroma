ALTER TABLE "staff_profiles"
ADD COLUMN "staff_type" TEXT NOT NULL DEFAULT 'custom';

-- Preserve existing admin support staff at the least privilege needed for
-- their current work. Distributor/city staff use a different permission set.
UPDATE "staff_profiles" AS staff
SET "staff_type" = 'customer_support',
    "permissions" = '["support_center:view", "support_center:reply"]'::jsonb
FROM "users" AS owner
WHERE staff."owner_id" = owner."id"
  AND owner."role" = 'admin'
  AND staff."permissions" ? 'support_center';
