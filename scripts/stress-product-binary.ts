import 'dotenv/config'
import assert from 'node:assert/strict'
import { Client } from 'pg'
import { calculateProductBinaryDailyCap } from '../src/app/lib/productBinaryCap'
import { PRODUCT_BINARY_PAIR_AMOUNT, PRODUCT_BINARY_DAILY_CAPS } from '../src/app/lib/productBinaryPlan'

const puPerLegPerPair = process.argv.includes('--three-per-leg') ? 3 : 2

// Offline economic scenarios; optional database inspection uses a read-only transaction.
// One bottle = one PU; each leaf buys two bottles. Every ancestor participates.
function balanced(depth: number, cap: number) {
  const buyers = 2 ** depth
  let pairs = 0, payable = 0
  for (let level = 0; level < depth; level++) {
    const nodes = 2 ** level
    const perNode = Math.floor(2 * 2 ** (depth - level - 1) / puPerLegPerPair)
    const result = calculateProductBinaryDailyCap(perNode, 0, true, cap, true)
    pairs += nodes * perNode
    payable += nodes * result.payablePairs
  }
  const bottles = buyers * 2
  return { depth, buyers, bottles, pairs, uncappedLiability: pairs * PRODUCT_BINARY_PAIR_AMOUNT,
    uncappedPerBottle: pairs * PRODUCT_BINARY_PAIR_AMOUNT / bottles,
    sameDayPayable: payable * PRODUCT_BINARY_PAIR_AMOUNT,
    sameDayFlashout: (pairs - payable) * PRODUCT_BINARY_PAIR_AMOUNT,
    assumedReserve: bottles * 20 }
}

function annualNetwork(members: number, shape: 'balanced' | 'comb', cap: number) {
  const nodes = Array.from({ length: members }, (_, id) => ({
    parent: id === 0 ? -1 : shape === 'balanced' ? Math.floor((id - 1) / 2) : id % 2 ? Math.max(0, id - 2) : id - 1,
    leg: id % 2 ? 'left' : 'right', left: 0, right: 0, used: 0,
  }))
  let bottles = 0, pairs = 0, payablePairs = 0, flashoutPairs = 0, maximumDepth = 0
  let minimumReserve20 = 0, minimumReserve5 = 0
  // Each member buys two bottles every 30 days, staggered by member ID.
  // 365 days starting without carryover, so no PU reaches its 12-month expiry.
  for (let day = 0; day < 365; day++) {
    for (const node of nodes) node.used = 0
    for (let buyer = day % 30; buyer < members; buyer += 30) {
      bottles += 2
      let child = buyer, depth = 0
      while (nodes[child].parent >= 0) {
        const parent = nodes[child].parent, node = nodes[parent]
        if (nodes[child].leg === 'left') node.left += 2
        else node.right += 2
        const completed = Math.floor(Math.min(node.left, node.right) / puPerLegPerPair)
        node.left -= completed * puPerLegPerPair; node.right -= completed * puPerLegPerPair
        const result = calculateProductBinaryDailyCap(completed, node.used, true, cap, true)
        node.used += result.payablePairs
        assert.ok(node.used <= cap)
        pairs += completed; payablePairs += result.payablePairs; flashoutPairs += result.capFlashPairs
        minimumReserve20 = Math.min(minimumReserve20, bottles * 20 - payablePairs * PRODUCT_BINARY_PAIR_AMOUNT)
        minimumReserve5 = Math.min(minimumReserve5, bottles * 5 - payablePairs * PRODUCT_BINARY_PAIR_AMOUNT)
        child = parent; depth++
      }
      maximumDepth = Math.max(maximumDepth, depth)
    }
  }
  const payable = payablePairs * PRODUCT_BINARY_PAIR_AMOUNT
  return { members, shape, days: 365, purchaseFrequencyDays: 30, maximumDepth, bottles, pairs,
    payable, flashout: flashoutPairs * PRODUCT_BINARY_PAIR_AMOUNT, payablePerBottle: payable / bottles,
    assumedReserve: bottles * 20, minimumReserve20, minimumReserve5,
    closingUnmatchedPu: nodes.reduce((sum, n) => sum + n.left + n.right, 0) }
}

async function main() {
  let seed = 42
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  for (let i = 0; i < 100_000; i++) {
    const left = random() % 10001, right = random() % 10001
    const completed = Math.floor(Math.min(left, right) / puPerLegPerPair)
    const used = random() % 150, cap = [20, 40, 100][random() % 3], active = random() % 5 !== 0
    const result = calculateProductBinaryDailyCap(completed, used, true, cap, active)
    assert.equal(result.payablePairs + result.capFlashPairs + result.inactivePairs, completed)
    assert.ok(result.payablePairs <= Math.max(0, cap - used))
    assert.ok(left - completed * puPerLegPerPair >= 0 && right - completed * puPerLegPerPair >= 0)
    if (!active) assert.equal(result.payablePairs, 0)
  }
  const scenarios = Object.entries(PRODUCT_BINARY_DAILY_CAPS).map(([plan, cap]) => ({ plan, cap,
    balanced: [2, 8, 12, 16, 17, 18].map(depth => balanced(depth, cap)),
    annual: [annualNetwork(5000, 'balanced', cap), annualNetwork(1000, 'comb', cap)] }))
  console.log(JSON.stringify({ invariantCases: 100000, assumptions: {
    puPerBottle: 1, puPerLegPerPair, pairPesos: PRODUCT_BINARY_PAIR_AMOUNT,
    fundingPerBottle: '20 PHP only when exact paid-delivered Admin margin is at least 20 PHP',
    uncapped: 'Theoretical cumulative pair exposure before daily caps or PU expiry; not a payable forecast',
    sameDay: 'All leaves buy two bottles in one Manila day, zero opening PU, active ancestors',
  }, scenarios }, null, 2))
  if (process.argv.includes('--offline') || !process.env.DATABASE_URL) return
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })
  await client.connect()
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await client.query("SET LOCAL statement_timeout = '15s'")
    const queries = {
      funding: `SELECT snapshot_source,reconciliation_status,COUNT(*)::int lots,SUM(original_amount)::float original,SUM(remaining_amount)::float remaining FROM product_binary_funding_lots GROUP BY 1,2`,
      jobs: `SELECT status,qualification_status,COUNT(*)::int jobs FROM product_binary_settlement_jobs GROUP BY 1,2`,
      events: `SELECT COUNT(*)::int events,COALESCE(SUM(payable_amount),0)::float payable,COALESCE(SUM(flashout_amount),0)::float flashout FROM product_binary_pair_events`,
      completedJobIntegrity: `SELECT COUNT(*)::int completed_positive_pu_without_event FROM product_binary_settlement_jobs j LEFT JOIN product_binary_order_events e ON e.order_id=j.order_id WHERE j.status='completed' AND j.qualification_status='qualified_paid_delivery' AND j.total_pu_snapshot>0 AND e.id IS NULL`,
      expiry: `SELECT key,value FROM system_settings WHERE key='product_pu_expiry_months'`,
      installedGuards: `SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('consume_product_binary_funding','qualify_product_binary_order','guard_product_binary_funding_lot')`,
      appliedMigrations: `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL AND (migration_name LIKE '%product_binary%' OR migration_name LIKE '%product_pu%') ORDER BY migration_name`,
    }
    for (const [label, sql] of Object.entries(queries)) console.log(JSON.stringify({ [label]: (await client.query(sql)).rows }))
    await client.query('ROLLBACK')
  } finally { await client.end() }
}
main().catch(() => { console.error('Stress audit failed; inspect schema/connectivity without exposing connection credentials.'); process.exitCode = 1 })
