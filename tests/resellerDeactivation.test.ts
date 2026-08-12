import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ConcurrentDeactivationError, ReservedPayoutBlocksDeactivationError } from '../src/app/lib/resellerDeactivation'
import { expiredBinaryCarryoverValue } from '../src/app/lib/deactivationPolicy'

const route = readFileSync('src/app/api/admin/resellers/[id]/status/route.ts', 'utf8')

test('deactivation claims the current status exactly once', () => {
  assert.match(route, /tx\.user\.updateMany/)
  assert.match(route, /where: \{ id: userId, role: 'reseller', status: reseller\.status \}/)
  assert.match(route, /if \(claimed\.count !== 1\) throw new ConcurrentDeactivationError\(\)/)
  assert.equal(new ConcurrentDeactivationError().message.includes('already changed'), true)
})

test('reserved payout funds block wallet flush', () => {
  const reservedCheck = route.indexOf('Number(wallet.reserved_balance) > 0')
  const walletZero = route.indexOf("data: { balance: 0 }")
  assert.ok(reservedCheck >= 0 && walletZero > reservedCheck)
  assert.match(route, /ReservedPayoutBlocksDeactivationError/)
  assert.equal(new ReservedPayoutBlocksDeactivationError().message.includes('payout'), true)
})

test('status, points, wallet, Hiroma credit, commissions, and event share one transaction', () => {
  const transactionStart = route.indexOf('const result = await prisma.$transaction')
  const transactionEnd = route.indexOf('const { eventId', transactionStart)
  const protectedBlock = route.slice(transactionStart, transactionEnd)
  assert.match(protectedBlock, /tx\.user\.updateMany/)
  assert.match(protectedBlock, /SET left_points = 0, right_points = 0, is_active = false/)
  assert.match(protectedBlock, /tx\.wallet\.update/)
  assert.match(protectedBlock, /tx\.commission\.create/)
  assert.match(protectedBlock, /tx\.wallet\.upsert/)
  assert.match(protectedBlock, /tx\.resellerDeactivationEvent\.create/)
})

test('deactivation event has financial consistency constraints', () => {
  const migration = readFileSync('prisma/migrations/20260812230000_add_atomic_deactivation_events/migration.sql', 'utf8')
  assert.match(migration, /"total_flushed" = "points_value" \+ "wallet_value"/)
  assert.match(migration, /"flushed_points" >= 0/)
})

test('unmatched carryover points expire with zero monetary value', () => {
  assert.equal(expiredBinaryCarryoverValue(100, 20), 0)
  assert.equal(expiredBinaryCarryoverValue(0, 500), 0)
  assert.doesNotMatch(route, /totalPts \* 0\.50/)
  assert.match(route, /expiredBinaryCarryoverValue\(leftPts, rightPts\)/)
})

test('only actual wallet balance is transferred to Hiroma during deactivation', () => {
  assert.match(route, /const totalFlush = walletBalance/)
  assert.match(route, /const ptsValue = expiredBinaryCarryoverValue/)
  assert.doesNotMatch(route, /type: 'binary_pairing', amount: ptsValue/)
})
