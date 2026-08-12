import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import { creditCommissionExactlyOnce } from '../src/app/lib/commissionCredit'

test('retrying one commission event credits the wallet only once', async () => {
  const events = new Map<string, string>()
  let walletCredits = 0
  const tx = {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const id = String(values[0])
      const key = String(values[1])
      if (events.has(key)) return []
      events.set(key, id)
      return [{ id }]
    },
    commission: {
      findUnique: async ({ where }: { where: { event_key: string } }) => ({
        id: events.get(where.event_key)!, user_id: 'user-a', type: 'direct_referral', amount: 500,
      }),
    },
    wallet: {
      upsert: async () => { walletCredits += 1; return {} },
    },
  } as unknown as Prisma.TransactionClient

  const input = {
    eventKey: 'registration:pin-a:direct:user-a:payable',
    userId: 'user-a',
    type: 'direct_referral' as const,
    amount: 500,
  }
  const first = await creditCommissionExactlyOnce(tx, input)
  const retry = await creditCommissionExactlyOnce(tx, input)
  assert.equal(first.credited, true)
  assert.equal(retry.credited, false)
  assert.equal(walletCredits, 1)
  assert.equal(events.size, 1)
})

test('registration and upgrade keys include immutable PIN source events', () => {
  const direct = readFileSync('src/app/lib/directReferral.ts', 'utf8')
  const binary = readFileSync('src/app/lib/binaryCommission.ts', 'utf8')
  assert.match(direct, /registration:\$\{input\.sourceEventId\}:direct:/)
  assert.match(binary, /\$\{input\.sourceKind\}:\$\{input\.sourceEventId\}:binary:/)
  assert.match(binary, /:payable`/)
  assert.match(binary, /:flashout`/)
})

test('commission event keys are database-unique while legacy rows remain compatible', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const migration = readFileSync('prisma/migrations/20260813000000_add_commission_event_idempotency/migration.sql', 'utf8')
  assert.match(schema, /event_key\s+String\?\s+@unique/)
  assert.match(migration, /CREATE UNIQUE INDEX "commissions_event_key_key"/)
  assert.match(migration, /ADD COLUMN "event_key" VARCHAR\(255\)/)
})

test('Product Binary retains its existing unique order-level idempotency boundary', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const source = readFileSync('src/app/lib/productBinary.ts', 'utf8')
  assert.match(schema, /model ProductBinaryOrderEvent[\s\S]*order_id\s+String\s+@unique/)
  assert.match(source, /reason: 'already_processed'/)
})
