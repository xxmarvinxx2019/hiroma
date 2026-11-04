import 'dotenv/config'
import assert from 'node:assert/strict'
import prisma from '../src/app/lib/prisma'
import { calculateProductBinaryPool, getProductBinaryPoolWeek } from '../src/app/lib/productBinaryPool'

async function main() {
  const current = getProductBinaryPoolWeek(new Date())
  const date = process.argv[2]
  const selected = date ? new Date(date + 'T00:00:00+08:00') : new Date(current.start.getTime() - 1)
  assert.ok(Number.isFinite(selected.getTime()), 'Supply a valid Manila date.')
  const { start, endExclusive } = getProductBinaryPoolWeek(selected)
  assert.ok(endExclusive <= current.start, 'Choose a closed Manila week.')

  const report = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`
    const [volume] = await tx.$queryRaw<{ bottles: bigint; orders: bigint; distinct_orders: bigint }[]>`
      SELECT COALESCE(SUM(eligible_units), 0)::bigint AS bottles,
        COUNT(*) AS orders, COUNT(DISTINCT order_id) AS distinct_orders
      FROM product_binary_order_events
      WHERE processed_at >= ${start} AND processed_at < ${endExclusive}
    `
    const members = await tx.$queryRaw<{ userId: string; pairs: bigint; credited: bigint }[]>`
      SELECT e.recipient_user_id AS "userId", SUM(e.payable_pairs)::bigint AS pairs,
        COALESCE(SUM(w.balance_delta * 100), 0)::bigint AS credited
      FROM product_binary_pair_events e
      LEFT JOIN wallet_ledger_entries w ON w.commission_id = e.normal_commission_id
        AND w.entry_type = 'commission_credit'
      WHERE e.created_at >= ${start} AND e.created_at < ${endExclusive}
      GROUP BY e.recipient_user_id
      ORDER BY e.recipient_user_id
    `
    assert.equal(volume.orders, volume.distinct_orders, 'Duplicate order events would inflate the pool.')
    const result = calculateProductBinaryPool(volume.bottles, BigInt(500), members)
    assert.deepEqual(result, calculateProductBinaryPool(volume.bottles, BigInt(500), members))
    const projected = result.allocations.reduce((sum, row) => sum + row.amountCentavos, BigInt(0))
    assert.ok(projected <= result.poolCentavos, 'Projected payout exceeds pool.')
    return {
      start: start.toISOString(),
      endExclusive: endExclusive.toISOString(),
      orders: volume.orders,
      qualifiedBottles: volume.bottles,
      qualifiedPairs: result.totalPairs,
      poolCentavos: result.poolCentavos,
      projectedPayoutCentavos: projected,
      unusedCentavos: result.poolCentavos - projected,
      actualWalletCreditsCentavos: members.reduce((sum, member) => sum + member.credited, BigInt(0)),
    }
  }, { isolationLevel: 'RepeatableRead' })

  console.log(JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Closed-week reconciliation failed.')
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
