-- Territory assignment is exclusive while active:
-- one Regional per region, one Provincial per province, and one City/Branch per city or municipality.
-- Advisory transaction locks make the trigger safe against simultaneous registrations.
-- Existing conflicts are preserved for explicit Admin reconciliation; no account is silently disabled.

CREATE INDEX IF NOT EXISTS "distributor_profiles_level_active_region_idx"
  ON "distributor_profiles" ("dist_level", "is_active", "region_code");
CREATE INDEX IF NOT EXISTS "distributor_profiles_level_active_province_idx"
  ON "distributor_profiles" ("dist_level", "is_active", "province_code");
CREATE INDEX IF NOT EXISTS "distributor_profiles_level_active_city_idx"
  ON "distributor_profiles" ("dist_level", "is_active", "city_muni_code");

CREATE OR REPLACE FUNCTION enforce_exclusive_distributor_territory()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  territory_scope TEXT;
  territory_code TEXT;
BEGIN
  IF NOT NEW.is_active THEN
    RETURN NEW;
  END IF;

  IF NEW.dist_level::text = 'regional' THEN
    territory_scope := 'regional';
    territory_code := NEW.region_code;
  ELSIF NEW.dist_level::text = 'provincial' THEN
    territory_scope := 'provincial';
    territory_code := NEW.province_code;
  ELSIF NEW.dist_level::text IN ('city', 'branch') THEN
    territory_scope := 'city_or_branch';
    territory_code := NEW.city_muni_code;
  ELSE
    RETURN NEW;
  END IF;

  IF territory_code IS NULL OR btrim(territory_code) = '' THEN
    RAISE EXCEPTION 'TERRITORY_CODE_REQUIRED' USING ERRCODE = '23514';
  END IF;

  -- Ordinary profile edits on a grandfathered assignment remain possible.
  IF TG_OP = 'UPDATE'
     AND OLD.is_active = NEW.is_active
     AND OLD.dist_level = NEW.dist_level
     AND (CASE territory_scope
       WHEN 'regional' THEN OLD.region_code IS NOT DISTINCT FROM NEW.region_code
       WHEN 'provincial' THEN OLD.province_code IS NOT DISTINCT FROM NEW.province_code
       ELSE OLD.city_muni_code IS NOT DISTINCT FROM NEW.city_muni_code
     END)
  THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('hiroma_territory:' || territory_scope || ':' || territory_code, 0));

  IF EXISTS (
    SELECT 1
    FROM distributor_profiles existing
    WHERE existing.id <> NEW.id
      AND existing.is_active
      AND (CASE territory_scope
        WHEN 'regional' THEN existing.dist_level::text = 'regional' AND existing.region_code = territory_code
        WHEN 'provincial' THEN existing.dist_level::text = 'provincial' AND existing.province_code = territory_code
        ELSE existing.dist_level::text IN ('city', 'branch') AND existing.city_muni_code = territory_code
      END)
  ) THEN
    RAISE EXCEPTION 'TERRITORY_ALREADY_ASSIGNED:%:%', territory_scope, territory_code USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS distributor_profiles_exclusive_territory ON distributor_profiles;
CREATE TRIGGER distributor_profiles_exclusive_territory
BEFORE INSERT OR UPDATE OF is_active, dist_level, region_code, province_code, city_muni_code
ON distributor_profiles
FOR EACH ROW EXECUTE FUNCTION enforce_exclusive_distributor_territory();

REVOKE ALL ON FUNCTION enforce_exclusive_distributor_territory() FROM PUBLIC;
