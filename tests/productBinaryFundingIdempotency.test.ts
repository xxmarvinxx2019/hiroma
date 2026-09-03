import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import { assertProductBinaryCommissionIsFullyFunded } from '../src/app/lib/productBinaryFundingGuard'

const migration = readFileSync(
  new URL('../prisma/migrations/20260901173000_enforce_funded_product_binary_commissions/migration.sql', import.meta.url),
  'utf8',
)

test('funding allocation serializes the global pool and rechecks the exact commission', () => {
  const lock = migration.indexOf("pg_advisory_xact_lock(hashtext('product-binary-funding'))")
  const recheck = migration.indexOf('WHERE "commission_id" = target_commission_id', lock)
  const firstMutation = migration.indexOf('UPDATE "product_binary_funding_lots"')
  assert.ok(lock >= 0 && lock < recheck && recheck < firstMutation)
})

test('funding allocator waits for FIFO lots instead of treating lock contention as unfunded', () => {
  assert.match(migration, /ORDER BY "allocated_at" ASC, "id" ASC\s+FOR UPDATE\s+LIMIT 1/)
  assert.doesNotMatch(migration, /SKIP LOCKED/)
})

test('shortfalls abort instead of creating an unfunded consumption', () => {
  assert.match(migration, /Historical unfunded Product Binary commissions require reconciliation/)
  assert.match(migration, /IF available < target_amount THEN[\s\S]*RAISE EXCEPTION/)
  assert.match(migration, /Product Binary reserve changed during consumption/)
  assert.doesNotMatch(migration, /remaining, true, at_time/)
})

test('application guard rejects partial funding before wallet credit', async () => {
  const tx = {
    $queryRaw: async () => [{ funded_amount: '15.00', unfunded_amount: '5.00' }],
  } as unknown as Prisma.TransactionClient

  await assert.rejects(
    assertProductBinaryCommissionIsFullyFunded(tx, 'commission-a', 20),
    /not fully funded/i,
  )
})

test('application guard accepts an exactly funded Product Binary commission', async () => {
  const tx = {
    $queryRaw: async () => [{ funded_amount: '20.00', unfunded_amount: '0.00' }],
  } as unknown as Prisma.TransactionClient

  await assert.doesNotReject(
    assertProductBinaryCommissionIsFullyFunded(tx, 'commission-b', 20),
  )
})

test('normal Product Binary is verified before wallet credit while flashout stays retained', () => {
  const source = readFileSync(
    new URL('../src/app/lib/productBinary.ts', import.meta.url),
    'utf8',
  )
  const protectedCredit = source.indexOf('await creditCommissionExactlyOnce')
  assert.ok(protectedCredit >= 0)
  assert.doesNotMatch(source, /(?:INSERT INTO|UPDATE)\s+wallets/i)
  assert.match(source, /await recordCommissionExactlyOnce\(tx,[\s\S]*type: 'sponsor_point'[\s\S]*isOverflow: true/)
  assert.match(
    migration,
    /NEW\."type" = 'sponsor_point'[\s\S]*NEW\."is_pair_overflow" = false[\s\S]*consume_product_binary_funding/,
  )
})
