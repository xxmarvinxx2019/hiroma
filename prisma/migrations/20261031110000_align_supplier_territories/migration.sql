BEGIN;
LOCK TABLE distributor_profiles IN SHARE ROW EXCLUSIVE MODE;
-- Fail on existing conflicts; never silently deactivate or reassign accounts.
CREATE UNIQUE INDEX distributor_active_region_unique ON distributor_profiles(btrim(region_code))
 WHERE is_active AND dist_level='regional' AND NULLIF(btrim(region_code),'') IS NOT NULL;
CREATE UNIQUE INDEX distributor_active_province_unique ON distributor_profiles(btrim(province_code))
 WHERE is_active AND dist_level='provincial' AND NULLIF(btrim(province_code),'') IS NOT NULL;
CREATE UNIQUE INDEX distributor_active_city_branch_unique ON distributor_profiles(btrim(city_muni_code))
 WHERE is_active AND dist_level IN ('city','branch') AND NULLIF(btrim(city_muni_code),'') IS NOT NULL;

CREATE FUNCTION validate_distributor_parent_territory() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE parent distributor_profiles%ROWTYPE;
BEGIN
 IF NEW.is_active AND (NULLIF(btrim(NEW.region_code),'') IS NULL
   OR (NEW.dist_level::text IN ('provincial','city','branch') AND NULLIF(btrim(NEW.province_code),'') IS NULL)
   OR (NEW.dist_level::text IN ('city','branch') AND NULLIF(btrim(NEW.city_muni_code),'') IS NULL))
 THEN RAISE EXCEPTION 'DISTRIBUTOR_TERRITORY_REQUIRED' USING ERRCODE='23514'; END IF;
 IF NEW.parent_dist_id IS NOT NULL THEN
   SELECT * INTO parent FROM distributor_profiles WHERE id=NEW.parent_dist_id FOR SHARE;
   IF NOT FOUND OR parent.id=NEW.id OR
     NOT ((NEW.dist_level::text IN ('city','branch') AND parent.dist_level::text='provincial'
       AND NULLIF(btrim(NEW.province_code),'')=NULLIF(btrim(parent.province_code),'')
       AND NULLIF(btrim(NEW.region_code),'')=NULLIF(btrim(parent.region_code),''))
     OR (NEW.dist_level::text IN ('city','branch','provincial') AND parent.dist_level::text='regional'
       AND NULLIF(btrim(NEW.region_code),'')=NULLIF(btrim(parent.region_code),''))) IS TRUE
   THEN RAISE EXCEPTION 'DISTRIBUTOR_PARENT_TERRITORY_MISMATCH' USING ERRCODE='23514'; END IF;
 END IF;
 -- A parent location/level edit must not strand existing child assignments.
 IF EXISTS(SELECT 1 FROM distributor_profiles c WHERE c.parent_dist_id=NEW.id AND c.is_active AND
   NOT ((c.dist_level::text IN ('city','branch') AND NEW.dist_level::text='provincial'
      AND NULLIF(btrim(c.province_code),'')=NULLIF(btrim(NEW.province_code),'')
      AND NULLIF(btrim(c.region_code),'')=NULLIF(btrim(NEW.region_code),''))
    OR (c.dist_level::text IN ('city','branch','provincial') AND NEW.dist_level::text='regional'
      AND NULLIF(btrim(c.region_code),'')=NULLIF(btrim(NEW.region_code),''))) IS TRUE)
 THEN RAISE EXCEPTION 'DISTRIBUTOR_CHILD_TERRITORY_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distributor_parent_territory BEFORE INSERT OR UPDATE OF parent_dist_id,region_code,province_code,city_muni_code,dist_level,is_active
 ON distributor_profiles FOR EACH ROW EXECUTE FUNCTION validate_distributor_parent_territory();
REVOKE ALL ON FUNCTION validate_distributor_parent_territory() FROM PUBLIC;

CREATE OR REPLACE FUNCTION can_supply_reward_stock(supplier TEXT,recipient TEXT,replacement_kind TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT supplier<>recipient AND EXISTS(
   SELECT 1 FROM users s JOIN users r ON r.id=recipient
   JOIN distributor_profiles buyer ON buyer.user_id=r.id
   LEFT JOIN distributor_profiles source ON source.user_id=s.id
   WHERE s.id=supplier AND s.status::text='active' AND r.status::text='active' AND buyer.is_active
    AND ((r.role::text='city' AND buyer.dist_level::text IN ('city','branch')) OR r.role::text=buyer.dist_level::text)
    AND buyer.dist_level::text IN ('city','branch','provincial','regional')
    AND ((s.role::text='admin' AND replacement_kind IN ('internal_replenishment','distributor_replacement'))
     OR (replacement_kind='distributor_replacement' AND buyer.dist_level::text<>'branch'
       AND source.is_active AND source.dist_level::text=s.role::text AND
         ((s.role::text='provincial' AND buyer.dist_level::text='city'
           AND NULLIF(btrim(source.province_code),'')=NULLIF(btrim(buyer.province_code),'')
           AND NULLIF(btrim(source.region_code),'')=NULLIF(btrim(buyer.region_code),''))
          OR (s.role::text='regional' AND buyer.dist_level::text IN ('city','provincial')
           AND NULLIF(btrim(source.region_code),'')=NULLIF(btrim(buyer.region_code),'')))))
 );
$$;
COMMIT;
