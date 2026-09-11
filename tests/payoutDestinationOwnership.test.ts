import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { payoutDestinationHash } from '../src/app/lib/payoutDestinationOwner'

const migration = readFileSync('prisma/migrations/20260911101000_bind_payout_destination_to_identity/migration.sql', 'utf8')
const route = readFileSync('src/app/api/payment-methods/route.ts', 'utf8')

test('same destination formatting produces one permanent ownership key', () => {
  assert.equal(payoutDestinationHash('gcash', null, '0912 345 6789'), payoutDestinationHash('GCASH', '', '0912-345-6789'))
  assert.notEqual(payoutDestinationHash('bank_transfer', 'BDO', '1234'), payoutDestinationHash('bank_transfer', 'Metrobank', '1234'))
})

test('database allows reuse by the same identity but rejects another identity', () => {
  assert.match(migration, /WHERE "payout_destination_owners"\."identity_hash" = EXCLUDED\."identity_hash"/)
  assert.match(migration, /permanently registered to another verified person/)
  assert.match(migration, /Existing payout destinations are claimed by multiple verified identities/)
  assert.match(migration, /identity_document_hash/)
})

test('reseller payment-method creation claims destination ownership transactionally', () => {
  assert.match(route, /prisma\.\$transaction/)
  assert.match(route, /claimPayoutDestinationOwner/)
  assert.match(route, /Complete identity verification before registering a payout account/)
  assert.match(route, /belongs to another verified person/)
})
