import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  ConcurrentDeactivationError,
  ReservedPayoutBlocksDeactivationError,
  UnreconciledWalletBlocksDeactivationError,
} from '../src/app/lib/resellerDeactivation'
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
  const walletForfeit = route.indexOf("entryType: 'deactivation_forfeit'")
  assert.ok(reservedCheck >= 0 && walletForfeit > reservedCheck)
  assert.match(route, /ReservedPayoutBlocksDeactivationError/)
  assert.equal(new ReservedPayoutBlocksDeactivationError().message.includes('payout'), true)
})

test('status, points, immutable wallet ledger, Hiroma retention, event, and audit share one transaction', () => {
  const transactionStart = route.indexOf('const result = await prisma.$transaction')
  const transactionEnd = route.indexOf('const { eventId', transactionStart)
  const protectedBlock = route.slice(transactionStart, transactionEnd)
  assert.match(protectedBlock, /tx\.user\.updateMany/)
  assert.match(protectedBlock, /SET left_points = 0, right_points = 0, is_active = false/)
  assert.match(protectedBlock, /appendWalletLedgerEntryExactlyOnce/)
  assert.match(protectedBlock, /recordCommissionExactlyOnce/)
  assert.match(protectedBlock, /tx\.resellerDeactivationEvent\.create/)
  assert.match(protectedBlock, /createRequiredAuditLog/)
  assert.doesNotMatch(protectedBlock, /tx\.wallet\.(?:update|upsert)/)
  assert.doesNotMatch(protectedBlock, /tx\.commission\.create/)
})

test('unreconciled source-backed liabilities block deactivation before the event', () => {
  const reconciliation = route.indexOf('funded_liability')
  const event = route.indexOf('tx.resellerDeactivationEvent.create')
  assert.ok(reconciliation >= 0 && reconciliation < event)
  assert.match(route, /direct_referral_reserve_lots/)
  assert.match(route, /binary_payable_lots/)
  assert.match(route, /product_binary_payable_lots/)
  assert.match(route, /Math\.abs\(walletBalance - fundedLiability\) >= 0\.005/)
  assert.equal(new UnreconciledWalletBlocksDeactivationError().message.includes('Reconcile'), true)
})

test('even a zero-value deactivation gets exactly one wallet ledger event', () => {
  const ledger = route.indexOf('await appendWalletLedgerEntryExactlyOnce')
  const positiveOnly = route.indexOf('if (walletBalance > 0)', ledger)
  const retained = route.indexOf('await recordCommissionExactlyOnce', positiveOnly)
  assert.ok(ledger >= 0 && positiveOnly > ledger && retained > positiveOnly)
})

test('activation and suspension are atomically audited with their profile status', () => {
  const ordinaryTransition = route.slice(route.indexOf('// Activate or suspend'))
  assert.match(ordinaryTransition, /SET is_active = \$\{status === 'active'\}/)
  assert.match(ordinaryTransition, /activity_type: 'reseller_status_changed'/)
  assert.match(ordinaryTransition, /from_status: reseller\.status, to_status: status/)
  assert.match(ordinaryTransition, /createRequiredAuditLog\(tx/)
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
  assert.match(route, /type: 'deactivation_wallet_transfer',[\s\S]{0,120}amount: walletBalance/)
  assert.doesNotMatch(route, /type: 'binary_pairing', amount: walletBalance/)
})
