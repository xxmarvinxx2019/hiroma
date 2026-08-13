import "dotenv/config";
import prisma from "../src/app/lib/prisma";
import { calculateBinaryFundingPosition } from "../src/app/lib/binaryAccounting";
import {
  loadBinaryFundingMovement,
  loadBinaryFundingPosition,
} from "../src/app/lib/binaryAccountingReport";
import { loadBinaryCommissionBreakdowns } from "../src/app/lib/binaryCommissionBreakdowns";

async function main() {
  const cutoff = new Date();
  const [reserve, liabilityRows] = await Promise.all([
    loadBinaryFundingPosition(cutoff),
    prisma.$queryRaw<{ amount: number }[]>`
      SELECT GREATEST(
        COALESCE((SELECT SUM(original_amount) FROM binary_payable_lots WHERE allocated_at <= ${cutoff}),0)
        - COALESCE((SELECT SUM(c.amount) FROM binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id
            WHERE p.status='released' AND COALESCE(p.payout_date,p.processed_at,c.allocated_at) <= ${cutoff}),0), 0
      )::float amount
    `,
  ]);

  const position = calculateBinaryFundingPosition({
    payableLiability: Number(liabilityRows[0]?.amount || 0),
    uncommittedReserve: reserve.uncommitted,
    earmarkedReserve: reserve.earmarked,
  });

  const monthStart = new Date(
    cutoff.getFullYear(),
    cutoff.getMonth(),
    1,
  );
  const openingCutoff = new Date(monthStart.getTime() - 1);
  const [openingReserve, movement, breakdowns, periodTotals, snapshotRows] = await Promise.all([
    loadBinaryFundingPosition(openingCutoff),
    loadBinaryFundingMovement(monthStart, cutoff),
    loadBinaryCommissionBreakdowns(monthStart, cutoff),
    prisma.$queryRaw<{ earned: number; flashout: number }[]>`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE is_pair_overflow=false),0)::float earned,
        COALESCE(SUM(amount) FILTER (WHERE is_pair_overflow=true),0)::float flashout
      FROM commissions
      WHERE type='binary_pairing' AND created_at >= ${monthStart} AND created_at <= ${cutoff}
    `,
    prisma.$queryRaw<{ source: string; rows: number }[]>`
      SELECT package_snapshot_source source, COUNT(*)::int rows
      FROM binary_pair_events GROUP BY package_snapshot_source ORDER BY package_snapshot_source
    `,
  ]);
  const openingHeld = openingReserve.uncommitted + openingReserve.earmarked;
  const expectedClosing =
    openingHeld +
    movement.allocated -
    movement.released_from_reserve -
    movement.flashout_reclassified;

  if (Math.abs(expectedClosing - position.totalReserveHeld) > 0.009) {
    throw new Error(
      `Binary reserve does not reconcile: expected ${expectedClosing}, got ${position.totalReserveHeld}.`,
    );
  }

  const sum = (rows: Array<{ amount: number }>) =>
    rows.reduce((total, row) => total + Number(row.amount || 0), 0);
  const checks = {
    earnedBreakdown: sum(breakdowns.earned),
    flashoutBreakdown: sum(breakdowns.flashout),
    reserveAllocatedBreakdown: sum(breakdowns.reserve_allocated),
    reserveMovementBreakdown: sum(breakdowns.reserve_movement),
  };
  const expectedReserveMovement =
    movement.allocated - movement.released_from_reserve - movement.flashout_reclassified;
  const assertions: Array<[string, number, number]> = [
    ["earned breakdown", checks.earnedBreakdown, Number(periodTotals[0]?.earned || 0)],
    ["flashout breakdown", checks.flashoutBreakdown, Number(periodTotals[0]?.flashout || 0)],
    ["reserve allocation breakdown", checks.reserveAllocatedBreakdown, movement.allocated],
    ["reserve movement breakdown", checks.reserveMovementBreakdown, expectedReserveMovement],
  ];
  for (const [label, actual, expected] of assertions) {
    if (Math.abs(actual - expected) > 0.009)
      throw new Error(`${label} does not reconcile: expected ${expected}, got ${actual}.`);
  }

  console.log(
    JSON.stringify(
      {
        position,
        movement,
        openingHeld,
        reserveReconciles: true,
        breakdownChecks: checks,
        packageSnapshotRows: snapshotRows,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
