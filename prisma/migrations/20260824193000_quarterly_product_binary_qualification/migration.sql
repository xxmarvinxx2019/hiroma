-- Product Binary qualification is a calendar-quarter season in Asia/Manila.
ALTER TABLE "reseller_profiles"
ADD COLUMN IF NOT EXISTS "qualification_quarter_start" TIMESTAMPTZ;

-- Every package starts at 10 points x PHP 0.50 = PHP 5 per product pair.
UPDATE "packages" SET "point_php_value" = 10;

-- Rank names and PU thresholds remain customizable; the three payout levels are universal.
UPDATE "ranks"
SET "pair_income" = CASE
  WHEN "sequence" = 1 THEN 20
  WHEN "sequence" = 2 THEN 30
  ELSE 40
END;

-- Rebuild personal qualification from delivered Product Binary events in the
-- current Manila quarter so older PU cannot leak into the rollout quarter.
WITH current_quarter AS (
  SELECT date_trunc('quarter', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila' AS starts_at
)
UPDATE reseller_profiles rp
SET total_pu = COALESCE((
      SELECT SUM(e.total_pu)::int FROM product_binary_order_events e
      WHERE e.buyer_user_id = rp.user_id AND e.processed_at >= cq.starts_at
    ), 0),
    qualification_quarter_start = cq.starts_at
FROM current_quarter cq;

UPDATE reseller_profiles rp
SET rank = COALESCE((
  SELECT r.name FROM ranks r
  WHERE r.package_id = rp.package_id AND r.required_pu <= rp.total_pu
  ORDER BY r.sequence DESC LIMIT 1
), 'default');

CREATE INDEX IF NOT EXISTS "reseller_profiles_qualification_quarter_idx"
ON "reseller_profiles"("qualification_quarter_start");
