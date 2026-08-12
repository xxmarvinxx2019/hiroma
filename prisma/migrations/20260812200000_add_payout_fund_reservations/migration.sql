ALTER TABLE "wallets"
ADD COLUMN "reserved_balance" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Back existing pending/approved payouts with wallet funds. Abort safely when
-- legacy open payouts are already inconsistent with the physical balance.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "payouts" p
    LEFT JOIN "wallets" w ON w."user_id" = p."user_id"
    WHERE p."status" IN ('pending', 'approved')
    GROUP BY w."id", w."balance"
    HAVING w."id" IS NULL OR SUM(p."amount") > w."balance"
  ) THEN
    RAISE EXCEPTION 'Open payouts exceed wallet balance; reconcile them before enabling payout reservations.';
  END IF;
END $$;

WITH open_payouts AS (
  SELECT "user_id", SUM("amount") AS amount
  FROM "payouts"
  WHERE "status" IN ('pending', 'approved')
  GROUP BY "user_id"
)
UPDATE "wallets" w
SET "reserved_balance" = open_payouts.amount
FROM open_payouts
WHERE w."user_id" = open_payouts."user_id";

ALTER TABLE "wallets"
ADD CONSTRAINT "wallet_non_negative_reserved_balance_check"
CHECK (
  "balance" >= 0
  AND "reserved_balance" >= 0
  AND "reserved_balance" <= "balance"
);
