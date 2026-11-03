import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import { claimIdentityAccountSlot, IdentityAccountLimitError } from '../src/app/lib/identityAccountLimit'

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

test('status transitions never release or reclaim lifetime capacity', () => {
  const source = readFileSync('src/app/api/admin/resellers/[id]/status/route.ts', 'utf8')
  assert.doesNotMatch(source, /releaseIdentityAccountSlot|claimIdentityAccountSlot/)
})

import { getPersonAccountNameKey } from '../src/app/lib/nameFormat'
test('full legal identity includes middle name and normalizes formatting without merging word boundaries', () => {
 assert.equal(getPersonAccountNameKey('  Juan   Santos Cruz Jr.'), getPersonAccountNameKey('juan santos cruz'))
 assert.notEqual(getPersonAccountNameKey('Juan Santos Cruz'),getPersonAccountNameKey('Juan Reyes Cruz'))
 assert.notEqual(getPersonAccountNameKey('Ann A Bell'),getPersonAccountNameKey('Anna Bell'))
})
test('different-person confirmation and inactive status cannot reset the name count', () => {
 const source=readFileSync('src/app/lib/usernameGenerator.ts','utf8')
 assert.match(source,/const existingAccountCount = samePersonAccounts.length/)
 assert.match(source,/input.identityConfirmation === 'different'/)
 assert.doesNotMatch(source,/status != 'inactive'/)
})
