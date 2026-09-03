BEGIN;

-- Keep the preflight, trigger installation, and concurrent admin edits behind
-- one boundary. Application package edits use the same advisory lock.
LOCK TABLE "package_upgrade_paths", "packages" IN SHARE ROW EXCLUSIVE MODE;
SELECT pg_advisory_xact_lock(hashtext('package-upgrade-funding-configuration'));

DO $$
DECLARE
  invalid_paths TEXT;
BEGIN
  SELECT string_agg(path."id"::TEXT, ', ' ORDER BY path."id"::TEXT)
  INTO invalid_paths
  FROM "package_upgrade_paths" path
  JOIN "packages" source ON source."id" = path."from_package_id"
  JOIN "packages" target ON target."id" = path."to_package_id"
  WHERE path."is_active"
    AND (
      source."price" >= target."price"
      OR source."pairing_bonus_value" >= target."pairing_bonus_value"
      OR path."pin_price" <
         GREATEST(target."direct_referral_bonus" - source."direct_referral_bonus", 0)
         + GREATEST(target."pairing_bonus_value" - source."pairing_bonus_value", 0) * 0.50
    );

  IF invalid_paths IS NOT NULL THEN
    RAISE EXCEPTION
      'Active package upgrade paths require reconciliation before ordering enforcement: %',
      invalid_paths
      USING ERRCODE = '23514';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "validate_package_upgrade_path_ordering"()
RETURNS TRIGGER AS $$
DECLARE
  source RECORD;
  target RECORD;
  required_funding DECIMAL(12,2);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('package-upgrade-funding-configuration'));
  IF NOT NEW."is_active" THEN
    RETURN NEW;
  END IF;

  SELECT "id", "price", "direct_referral_bonus", "pairing_bonus_value", "is_active"
  INTO source
  FROM "packages"
  WHERE "id" = NEW."from_package_id"
  FOR SHARE;

  SELECT "id", "price", "direct_referral_bonus", "pairing_bonus_value", "is_active"
  INTO target
  FROM "packages"
  WHERE "id" = NEW."to_package_id"
  FOR SHARE;

  IF source."id" IS NULL OR target."id" IS NULL
     OR NOT source."is_active" OR NOT target."is_active"
     OR source."price" >= target."price"
     OR source."pairing_bonus_value" >= target."pairing_bonus_value" THEN
    RAISE EXCEPTION 'Upgrade source must be an active package lower than its active target in both price and Package Binary points.' USING ERRCODE = '23514';
  END IF;

  required_funding :=
    GREATEST(target."direct_referral_bonus" - source."direct_referral_bonus", 0)
    + GREATEST(target."pairing_bonus_value" - source."pairing_bonus_value", 0) * 0.50;
  IF NEW."pin_price" < required_funding THEN
    RAISE EXCEPTION 'Upgrade PIN price cannot fund its incremental retained-direct and Package Binary allocation.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "package_upgrade_paths_validate_ordering"
BEFORE INSERT OR UPDATE OF "from_package_id", "to_package_id", "pin_price", "is_active"
ON "package_upgrade_paths"
FOR EACH ROW EXECUTE FUNCTION "validate_package_upgrade_path_ordering"();

CREATE OR REPLACE FUNCTION "revalidate_package_upgrade_paths"()
RETURNS TRIGGER AS $$
DECLARE
  invalid_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('package-upgrade-funding-configuration'));

  SELECT COUNT(*)::INTEGER
  INTO invalid_count
  FROM "package_upgrade_paths" path
  JOIN "packages" source ON source."id" = path."from_package_id"
  JOIN "packages" target ON target."id" = path."to_package_id"
  WHERE path."is_active"
    AND (path."from_package_id" = NEW."id" OR path."to_package_id" = NEW."id")
    AND (
      NOT source."is_active"
      OR NOT target."is_active"
      OR source."price" >= target."price"
      OR source."pairing_bonus_value" >= target."pairing_bonus_value"
      OR path."pin_price" <
         GREATEST(target."direct_referral_bonus" - source."direct_referral_bonus", 0)
         + GREATEST(target."pairing_bonus_value" - source."pairing_bonus_value", 0) * 0.50
    );

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Package change would invalidate an active lower-to-higher funded upgrade path.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "packages_revalidate_upgrade_paths"
AFTER UPDATE OF "price", "direct_referral_bonus", "pairing_bonus_value", "is_active"
ON "packages"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "revalidate_package_upgrade_paths"();

COMMIT;
