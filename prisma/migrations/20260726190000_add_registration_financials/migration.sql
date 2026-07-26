-- A failed deployment may have created this new ledger table before its
-- historical backfill ran. Recreate only this derived ledger on retry.
DROP TABLE IF EXISTS "registration_financials";

CREATE TABLE "registration_financials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pin_id" TEXT NOT NULL,
    "city_dist_id" TEXT NOT NULL,
    "reseller_id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "customer_payment" DECIMAL(12,2) NOT NULL,
    "product_acquisition_cost" DECIMAL(12,2) NOT NULL,
    "reseller_value" DECIMAL(12,2) NOT NULL,
    "pin_allocation" DECIMAL(12,2) NOT NULL,
    "registration_profit" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_financials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "registration_financials_pin_id_key"
ON "registration_financials"("pin_id");

CREATE INDEX "registration_financials_city_dist_id_created_at_idx"
ON "registration_financials"("city_dist_id", "created_at");

CREATE INDEX "registration_financials_reseller_id_idx"
ON "registration_financials"("reseller_id");

-- Freeze the current economics for registrations completed before this ledger existed.
INSERT INTO "registration_financials" (
    "pin_id",
    "city_dist_id",
    "reseller_id",
    "package_id",
    "customer_payment",
    "product_acquisition_cost",
    "reseller_value",
    "pin_allocation",
    "registration_profit",
    "created_at"
)
SELECT
    p.id,
    p.city_dist_id,
    p.used_by,
    p.package_id,
    SUM(prod.price * pp.quantity),
    SUM(
        CASE
            WHEN dp.dist_level = 'branch'
                THEN COALESCE(NULLIF(prod.branch_price, 0), prod.cost_price)
            ELSE COALESCE(NULLIF(prod.city_price, 0), prod.cost_price)
        END * pp.quantity
    ),
    SUM(COALESCE(NULLIF(prod.reseller_price, 0), prod.price) * pp.quantity),
    GREATEST(
        0,
        SUM(
            (prod.price - COALESCE(NULLIF(prod.reseller_price, 0), prod.price))
            * pp.quantity
        )
    ),
    SUM(
        (
            COALESCE(NULLIF(prod.reseller_price, 0), prod.price) -
            CASE
                WHEN dp.dist_level = 'branch'
                    THEN COALESCE(NULLIF(prod.branch_price, 0), prod.cost_price)
                ELSE COALESCE(NULLIF(prod.city_price, 0), prod.cost_price)
            END
        ) * pp.quantity
    ),
    COALESCE(p.used_at, p.created_at)
FROM pins p
JOIN distributor_profiles dp ON dp.user_id = p.city_dist_id
JOIN package_products pp ON pp.package_id = p.package_id
JOIN products prod ON prod.id = pp.product_id
WHERE p.status = 'used'
  AND p.used_by IS NOT NULL
GROUP BY p.id, p.city_dist_id, p.used_by, p.package_id, dp.dist_level;
