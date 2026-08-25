import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  getManilaQuarter,
  PRODUCT_BINARY_BASE_POINTS,
  PRODUCT_BINARY_DEFAULT_THRESHOLDS,
  PRODUCT_BINARY_RANK_POINTS,
  requiredRankPoints,
} from '../src/app/lib/productBinaryQuarter'
import { calculateProductBinaryDailyCap } from '../src/app/lib/productBinaryCap'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

test('calendar quarters use Asia/Manila boundaries', () => {
  const q1 = getManilaQuarter(new Date('2026-03-31T15:59:59.999Z'))
  assert.equal(q1.label, 'Q1 2026')
  assert.equal(q1.start.toISOString(), '2025-12-31T16:00:00.000Z')
  assert.equal(q1.endExclusive.toISOString(), '2026-03-31T16:00:00.000Z')

  const q2 = getManilaQuarter(new Date('2026-03-31T16:00:00.000Z'))
  assert.equal(q2.label, 'Q2 2026')
  assert.equal(q2.start.toISOString(), '2026-03-31T16:00:00.000Z')

  const q4 = getManilaQuarter(new Date('2026-12-31T15:59:59.999Z'))
  assert.equal(q4.label, 'Q4 2026')
  assert.equal(q4.endExclusive.toISOString(), '2026-12-31T16:00:00.000Z')
})

test('all packages share the sanctioned Product Binary ladder', () => {
  assert.equal(PRODUCT_BINARY_BASE_POINTS * 0.5, 5)
  assert.deepEqual(PRODUCT_BINARY_RANK_POINTS.map(points => points * 0.5), [10, 15, 20])
  assert.deepEqual(PRODUCT_BINARY_DEFAULT_THRESHOLDS, [30, 50, 100])
  assert.equal(requiredRankPoints(1), 20)
  assert.equal(requiredRankPoints(2), 30)
  assert.equal(requiredRankPoints(3), 40)
  assert.equal(requiredRankPoints(4), null)
})

test('delivered-order processing resets only personal qualification before crediting PU', () => {
  const source = read('../src/app/lib/productBinary.ts')
  assert.match(source, /ensureCurrentProductBinaryQuarter\(tx, order\.buyer_id\)/)
  assert.match(source, /SET total_pu=COALESCE\(total_pu,0\)\+/)
  assert.match(source, /ensureCurrentProductBinaryQuarter\(tx, ancestor\.user_id\)/)
  assert.match(source, /PU_PER_LEG_PER_PAIR = 2/)
})

test('Product Binary daily cap pays only the remaining Manila-day allowance', () => {
  assert.deepEqual(calculateProductBinaryDailyCap(5, 48, true, 50, true), {
    payablePairs: 2,
    capFlashPairs: 3,
    inactivePairs: 0,
  })
  assert.deepEqual(calculateProductBinaryDailyCap(4, 50, true, 50, true), {
    payablePairs: 0,
    capFlashPairs: 4,
    inactivePairs: 0,
  })
  assert.deepEqual(calculateProductBinaryDailyCap(5, 48, false, 50, true), {
    payablePairs: 5,
    capFlashPairs: 0,
    inactivePairs: 0,
  })
  assert.deepEqual(calculateProductBinaryDailyCap(5, 0, true, 50, false), {
    payablePairs: 0,
    capFlashPairs: 0,
    inactivePairs: 5,
  })
})

test('City fulfillment routes delegate Personal PU and Product Binary to one processor', () => {
  const cityOrders = read('../src/app/api/city/orders/route.ts')
  const walkInOrders = read('../src/app/api/city/orders/reseller-orders/route.ts')
  for (const route of [cityOrders, walkInOrders]) {
    assert.match(route, /processDeliveredProductBinaryOrder\(order\.id\)/)
    assert.doesNotMatch(route, /if \(false && currentOrderPU/)
  }
})

test('quarter reset is cron-backed and migration normalizes existing packages', () => {
  const cron = read('../src/app/api/cron/reset-ranks/route.ts')
  const migration = read('../prisma/migrations/20260824193000_quarterly_product_binary_qualification/migration.sql')
  assert.match(cron, /qualification_quarter_start/)
  assert.match(cron, /SET rank = 'default', total_pu = 0/)
  assert.doesNotMatch(cron, /product_binary_positions/)
  assert.match(migration, /UPDATE "packages" SET "point_php_value" = 10/)
  assert.match(migration, /WHEN "sequence" = 1 THEN 20/)
  assert.match(migration, /WHEN "sequence" = 2 THEN 30/)
  assert.match(migration, /ELSE 40/)
})

test('future package creation installs the standard three rank defaults', () => {
  const route = read('../src/app/api/admin/packages/route.ts')
  assert.match(route, /point_php_value: PRODUCT_BINARY_BASE_POINTS/)
  assert.match(route, /tx\.rank\.createMany/)
  assert.match(route, /PRODUCT_BINARY_RANK_POINTS\.map/)
})
