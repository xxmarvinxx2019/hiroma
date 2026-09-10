import prisma from "@/app/lib/prisma";

type FundingPosition = { uncommitted: number; earmarked: number };
export type BinaryFundingMovement = {
  allocated: number;
  funded_earnings: number;
  flashout_reclassified: number;
  unfunded_earnings: number;
  released_from_reserve: number;
};

const number = (value: unknown) => Number(value || 0) || 0;

export async function loadBinaryFundingPosition(cutoff: Date) {
  const rows = await prisma.$queryRaw<FundingPosition[]>`
    WITH funded AS (
      SELECT rc.commission_id, SUM(rc.amount)::numeric funded_amount
      FROM binary_reserve_consumptions rc
      JOIN commissions c ON c.id=rc.commission_id
      WHERE rc.is_unfunded=false AND c.is_pair_overflow=false
        AND rc.consumed_at <= ${cutoff}
      GROUP BY rc.commission_id
    ), released AS (
      SELECT lot.commission_id, SUM(pc.amount)::numeric released_amount
      FROM binary_payout_consumptions pc
      JOIN binary_payable_lots lot ON lot.id=pc.payable_lot_id
      JOIN payouts p ON p.id=pc.payout_id
      WHERE p.status='released'
        AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at) <= ${cutoff}
      GROUP BY lot.commission_id
    )
    SELECT
      GREATEST(
        COALESCE((SELECT SUM(original_amount) FROM binary_reserve_lots WHERE allocated_at <= ${cutoff}),0)
        - COALESCE((SELECT SUM(amount) FROM binary_reserve_consumptions WHERE is_unfunded=false AND consumed_at <= ${cutoff}),0),
        0
      )::float uncommitted,
      COALESCE((
        SELECT SUM(GREATEST(f.funded_amount - COALESCE(r.released_amount,0),0))
        FROM funded f LEFT JOIN released r ON r.commission_id=f.commission_id
      ),0)::float earmarked
  `;

  return {
    uncommitted: number(rows[0]?.uncommitted),
    earmarked: number(rows[0]?.earmarked),
  };
}

export async function loadBinaryFundingMovement(from: Date, to: Date) {
  const rows = await prisma.$queryRaw<BinaryFundingMovement[]>`
    WITH funded_by_commission AS (
      SELECT rc.commission_id, SUM(rc.amount)::numeric funded_amount
      FROM binary_reserve_consumptions rc
      JOIN commissions c ON c.id=rc.commission_id
      WHERE rc.is_unfunded=false AND c.is_pair_overflow=false
      GROUP BY rc.commission_id
    ), released_before AS (
      SELECT lot.commission_id, SUM(pc.amount)::numeric released_amount
      FROM binary_payout_consumptions pc
      JOIN binary_payable_lots lot ON lot.id=pc.payable_lot_id
      JOIN payouts p ON p.id=pc.payout_id
      WHERE p.status='released'
        AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at) < ${from}
      GROUP BY lot.commission_id
    ), released_to AS (
      SELECT lot.commission_id, SUM(pc.amount)::numeric released_amount
      FROM binary_payout_consumptions pc
      JOIN binary_payable_lots lot ON lot.id=pc.payable_lot_id
      JOIN payouts p ON p.id=pc.payout_id
      WHERE p.status='released'
        AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at) <= ${to}
      GROUP BY lot.commission_id
    )
    SELECT
      COALESCE((SELECT SUM(original_amount) FROM binary_reserve_lots WHERE allocated_at >= ${from} AND allocated_at <= ${to}),0)::float allocated,
      COALESCE((SELECT SUM(rc.amount) FROM binary_reserve_consumptions rc JOIN commissions c ON c.id=rc.commission_id
        WHERE rc.is_unfunded=false AND c.is_pair_overflow=false AND rc.consumed_at >= ${from} AND rc.consumed_at <= ${to}),0)::float funded_earnings,
      COALESCE((SELECT SUM(rc.amount) FROM binary_reserve_consumptions rc JOIN commissions c ON c.id=rc.commission_id
        WHERE rc.is_unfunded=false AND c.is_pair_overflow=true AND rc.consumed_at >= ${from} AND rc.consumed_at <= ${to}),0)::float flashout_reclassified,
      COALESCE((SELECT SUM(rc.amount) FROM binary_reserve_consumptions rc JOIN commissions c ON c.id=rc.commission_id
        WHERE rc.is_unfunded=true AND c.is_pair_overflow=false AND rc.consumed_at >= ${from} AND rc.consumed_at <= ${to}),0)::float unfunded_earnings,
      COALESCE((SELECT SUM(
        LEAST(f.funded_amount,COALESCE(rt.released_amount,0))
        - LEAST(f.funded_amount,COALESCE(rb.released_amount,0))
      ) FROM funded_by_commission f
        LEFT JOIN released_before rb ON rb.commission_id=f.commission_id
        LEFT JOIN released_to rt ON rt.commission_id=f.commission_id),0)::float released_from_reserve
  `;

  const row = rows[0];
  return {
    allocated: number(row?.allocated),
    funded_earnings: number(row?.funded_earnings),
    flashout_reclassified: number(row?.flashout_reclassified),
    unfunded_earnings: number(row?.unfunded_earnings),
    released_from_reserve: number(row?.released_from_reserve),
  };
}
