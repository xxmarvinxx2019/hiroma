import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateProductBinaryBalance } from '../src/app/lib/productBinaryBalance'
import { readFileSync } from 'node:fs'

test('Product Binary balance follows the approved 2-left plus 2-right rule', () => {
  assert.deepEqual(calculateProductBinaryBalance(0, 0), {
    leftPu: 0, rightPu: 0, readyPairs: 0,
    leftNeeded: 2, rightNeeded: 2, focusSide: 'both',
  })
  assert.deepEqual(calculateProductBinaryBalance(6, 3), {
    leftPu: 6, rightPu: 3, readyPairs: 1,
    leftNeeded: 0, rightNeeded: 1, focusSide: 'right',
  })
})

test('negative or fractional input cannot create false carryover', () => {
  assert.deepEqual(calculateProductBinaryBalance(-5, 1.9), {
    leftPu: 0, rightPu: 1, readyPairs: 0,
    leftNeeded: 2, rightNeeded: 1, focusSide: 'left',
  })
})

test('dashboard separates package tree navigation from Product Binary rank guidance', () => {
  const dashboard = readFileSync('src/app/dashboard/reseller/page.tsx', 'utf8')
  assert.match(dashboard, /Product Binary PU Balance/)
  assert.match(dashboard, /TOTAL LEFT PRODUCT PU/)
  assert.match(dashboard, /TOTAL RIGHT PRODUCT PU/)
  assert.match(dashboard, /PU available carryover/)
  assert.match(dashboard, /Team carryover forms Product Binary pairs; your own purchase PU determines your quarterly rank/)
  assert.match(dashboard, /href="\/dashboard\/reseller\/tree"[\s\S]*View Package Binary/)
  assert.match(dashboard, /href="\/dashboard\/reseller\/tree\?mode=product"[\s\S]*View Product Binary/)
  assert.match(dashboard, /Earn \{puToNext\} more Personal PU/)
  assert.doesNotMatch(dashboard, /At 1 PU per bottle/)
  assert.match(dashboard, /label: 'Available Balance'/)
  assert.match(dashboard, /Available Wallet Balance/)
  assert.doesNotMatch(dashboard, /label: 'Total Points'/)
  const statsRoute = readFileSync('src/app/api/reseller/stats/route.ts', 'utf8')
  assert.match(statsRoute, /WITH RECURSIVE product_legs/)
  assert.match(statsRoute, /left_total_pu/)
  assert.match(statsRoute, /right_total_pu/)
})

test('tree provides separate read-only Package and Product Binary views', () => {
  const page = readFileSync('src/app/dashboard/reseller/tree/page.tsx', 'utf8')
  const route = readFileSync('src/app/api/reseller/tree/route.ts', 'utf8')
  assert.match(page, />Package Binary<\/button>/)
  assert.match(page, />Product Binary<\/button>/)
  assert.match(page, /my_product_binary/)
  assert.match(page, /node\.profile_photo/)
  assert.match(page, /selectedNode\.profile_photo/)
  assert.match(page, /Total Left Product PU/)
  assert.match(page, /Total Right Product PU/)
  assert.match(page, /PU available carryover/)
  assert.doesNotMatch(page, /label: 'Next Pair'/)
  assert.match(page, /Total Product Binary Earnings/)
  assert.match(page, /Lifetime Completed Pairs/)
  assert.match(page, /All Product Binary pairs completed since joining/)
  assert.match(page, /remaining_pu/)
  assert.match(page, /PU more to/)
  assert.match(page, /Current:/)
  assert.doesNotMatch(page, /Lifetime Payable Pairs/)
  assert.doesNotMatch(page, /today&apos;s rank rate/)
  assert.match(page, /Private wallet, earnings, rank balance, and personal carryover are not shown/)
  assert.match(route, /FROM product_binary_positions/)
  assert.match(route, /FROM product_binary_order_events/)
  assert.match(route, /getProfilePhotoDisplayUrl/)
  assert.match(route, /WITH RECURSIVE product_legs/)
  assert.match(route, /left_total_pu/)
  assert.match(route, /total_earned: selfCommissions\.points/)
  assert.doesNotMatch(route, /UPDATE product_binary_positions/)
  assert.doesNotMatch(route, /INSERT INTO product_binary_pair_events/)
  assert.match(route, /WITH RECURSIVE allowed/)
  assert.match(route, /outside your authorized downline/)
})
