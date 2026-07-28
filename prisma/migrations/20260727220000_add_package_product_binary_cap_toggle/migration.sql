ALTER TABLE packages
ADD COLUMN IF NOT EXISTS product_binary_cap_enabled BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE packages
SET product_binary_cap_enabled = TRUE
WHERE product_binary_cap_enabled IS NULL;
