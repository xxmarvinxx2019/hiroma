import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import { claimIdentityAccountSlot, IdentityAccountLimitError, releaseIdentityAccountSlot } from '../src/app/lib/identityAccountLimit'

function txReturning(changed: number) {
  return { $executeRaw: async () => changed } as unknown as Prisma.TransactionClient
}

test('an available verified-identity slot is claimed successfully', async () => {
  await assert.doesNotReject(claimIdentityAccountSlot(txReturning(1), 'a'.repeat(64)))
})

test('the eighth account is rejected by the atomic database claim', async () => {
  await assert.rejects(
    claimIdentityAccountSlot(txReturning(0), 'a'.repeat(64)),
    IdentityAccountLimitError,
  )
})

test('deactivation releases an occupied identity slot', async () => {
  await assert.doesNotReject(releaseIdentityAccountSlot(txReturning(1), 'a'.repeat(64)))
  await assert.rejects(releaseIdentityAccountSlot(txReturning(0), 'a'.repeat(64)))
})

test('database counter increment is conditional on the configured maximum', () => {
  const helper = readFileSync('src/app/lib/identityAccountLimit.ts', 'utf8')
  assert.match(helper, /ON CONFLICT \("identity_hash"\) DO UPDATE/)
  assert.match(helper, /WHERE "identity_account_limits"\."count" < "identity_account_limits"\."max_allowed"/)
})

test('City/Branch registration claims identity capacity before user creation', () => {
  const source = readFileSync('src/app/api/city/resellers/route.ts', 'utf8')
  const claim = source.indexOf('claimIdentityAccountSlot(tx, identityDocumentHash)')
  const createUser = source.indexOf('tx.user.create')
  assert.ok(claim >= 0 && createUser >= 0 && claim < createUser)
  assert.match(source, /error instanceof IdentityAccountLimitError/)
})

test('migration backfills existing verified identities and rejects legacy over-limit state', () => {
  const migration = readFileSync('prisma/migrations/20260812220000_enforce_identity_account_limit/migration.sql', 'utf8')
  assert.match(migration, /HAVING COUNT\(\*\) > 7/)
  assert.match(migration, /CHECK \("count" >= 0 AND "max_allowed" > 0 AND "count" <= "max_allowed"\)/)
  assert.match(migration, /GROUP BY "identity_document_hash"/)
})

test('inactive account transitions release and reclaim identity capacity transactionally', () => {
  const source = readFileSync('src/app/api/admin/resellers/[id]/status/route.ts', 'utf8')
  assert.match(source, /releaseIdentityAccountSlot\(tx, reseller\.identity_document_hash\)/)
  assert.match(source, /claimIdentityAccountSlot\(tx, reseller\.identity_document_hash\)/)
  assert.match(source, /error instanceof IdentityAccountLimitError/)
})
