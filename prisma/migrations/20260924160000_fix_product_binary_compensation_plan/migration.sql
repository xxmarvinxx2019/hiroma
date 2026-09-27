-- Product Binary compensation plan effective from this deployment:
-- every completed pair pays PHP 5 (10 points at PHP 0.50/point), while the
-- reseller package determines the maximum payable pairs per Manila day.

UPDATE "packages"
SET "point_php_value" = 10,
    "product_binary_cap_enabled" = true,
    "daily_product_pairing_cap" = CASE LOWER(TRIM("name"))
      WHEN 'gold' THEN 100
      WHEN 'silver' THEN 40
      ELSE 20
    END;

UPDATE "ranks" SET "pair_income" = 10;

CREATE OR REPLACE FUNCTION public.enforce_fixed_product_binary_package_plan()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."point_php_value" := 10;
  NEW."product_binary_cap_enabled" := true;
  NEW."daily_product_pairing_cap" := CASE LOWER(TRIM(NEW."name"))
    WHEN 'gold' THEN 100
    WHEN 'silver' THEN 40
    ELSE 20
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "packages_enforce_product_binary_plan" ON "packages";
CREATE TRIGGER "packages_enforce_product_binary_plan"
BEFORE INSERT OR UPDATE OF "name", "point_php_value", "product_binary_cap_enabled", "daily_product_pairing_cap"
ON "packages"
FOR EACH ROW EXECUTE FUNCTION public.enforce_fixed_product_binary_package_plan();

CREATE OR REPLACE FUNCTION public.enforce_fixed_product_binary_rank_rate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."pair_income" := 10;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ranks_enforce_product_binary_rate" ON "ranks";
CREATE TRIGGER "ranks_enforce_product_binary_rate"
BEFORE INSERT OR UPDATE OF "pair_income" ON "ranks"
FOR EACH ROW EXECUTE FUNCTION public.enforce_fixed_product_binary_rank_rate();
