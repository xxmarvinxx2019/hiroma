import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import {
  creditCommissionExactlyOnce,
  recordCommissionExactlyOnce,
} from '../src/app/lib/commissionCredit'

test('retrying one commission event credits the wallet only once', async () => {
  const events = new Map<string, string>()
  const ledgerCredits = new Set<string>()
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join(' ').includes('wallet_ledger_entries')) {
        const commissionId = String(values[0])
        ledgerCredits.add(commissionId)
        return [{ id: `ledger-${commissionId}`, balance_delta: '500.00', total_earned_delta: '500.00' }]
      }
      const id = String(values[0])
      const key = String(values[1])
      if (events.has(key)) return []
      events.set(key, id)
      return [{ id }]
    },
    commission: {
      findUnique: async ({ where }: { where: { event_key: string } }) => ({
        id: events.get(where.event_key)!,
        source_event_kind: 'registration',
        source_event_id: 'pin-a',
        rule_version: 'registration-direct-v1',
        user_id: 'user-a',
        type: 'direct_referral',
        amount: 500,
        points: null,
        source_user_id: null,
        is_pair_overflow: false,
        overflow_to: null,
      }),
    },
  } as unknown as Prisma.TransactionClient

  const input = {
    eventKey: 'registration:pin-a:direct:user-a:payable',
    sourceEventKind: 'registration' as const,
    sourceEventId: 'pin-a',
    ruleVersion: 'registration-direct-v1',
    userId: 'user-a',
    type: 'direct_referral' as const,
    amount: 500,
  }
  const first = await creditCommissionExactlyOnce(tx, input)
  const retry = await creditCommissionExactlyOnce(tx, input)
  assert.equal(first.credited, true)
  assert.equal(retry.credited, false)
  assert.equal(ledgerCredits.size, 1)
  assert.equal(events.size, 1)
})

test('a reused event key rejects conflicting source, points, or overflow metadata', async () => {
  const tx = {
    $queryRaw: async () => [],
    commission: {
      findUnique: async () => ({
        id: 'existing',
        source_event_kind: 'upgrade',
        source_event_id: 'pin-a',
        rule_version: 'package-binary-v1',
        user_id: 'user-a',
        type: 'binary_pairing',
        amount: 200,
        points: 400,
        source_user_id: 'source-a',
        is_pair_overflow: false,
        overflow_to: null,
      }),
    },
  } as unknown as Prisma.TransactionClient

  await assert.rejects(
    creditCommissionExactlyOnce(tx, {
      eventKey: 'upgrade:pin-a:binary:user-a:payable',
      sourceEventKind: 'upgrade',
      sourceEventId: 'pin-a',
      ruleVersion: 'package-binary-v1',
      userId: 'user-a',
      type: 'binary_pairing',
      amount: 200,
      points: 401,
      sourceUserId: 'source-b',
      isOverflow: true,
      overflowTo: 'hiroma',
    }),
    /conflicting financial details/i,
  )
})

test('retained commission evidence never credits a spendable wallet', async () => {
  let walletCredits = 0
  let rawQueries = 0
  const tx = {
    $queryRaw: async () => {
      rawQueries += 1
      return [{ id: 'retained-flashout' }]
    },
    wallet: {
      upsert: async () => { walletCredits += 1; return {} },
    },
  } as unknown as Prisma.TransactionClient

  const result = await recordCommissionExactlyOnce(tx, {
    eventKey: 'upgrade:pin-a:binary:user-a:flashout',
    sourceEventKind: 'upgrade',
    sourceEventId: 'pin-a',
    ruleVersion: 'package-binary-v1',
    userId: 'hiroma',
    type: 'binary_pairing',
    amount: 500,
    points: 1000,
    sourceUserId: 'source-a',
    isOverflow: true,
    overflowTo: 'hiroma',
  })

  assert.equal(result.recorded, true)
  assert.equal(walletCredits, 0)
  assert.equal(rawQueries, 1)
})

test('an unfunded binary commission never reaches the wallet', async () => {
  const walletCredits = 0
  let rawQueryCount = 0
  const tx = {
    $queryRaw: async () => {
      rawQueryCount += 1
      return rawQueryCount === 1
        ? [{ id: 'partially-funded-binary' }]
        : [{ funded_amount: '150.00', unfunded_amount: '50.00' }]
    },
  } as unknown as Prisma.TransactionClient

  await assert.rejects(
    creditCommissionExactlyOnce(tx, {
      eventKey: 'upgrade:pin-a:binary:user-a:payable',
      sourceEventKind: 'upgrade',
      sourceEventId: 'pin-a',
      ruleVersion: 'package-binary-v1',
      userId: 'user-a',
      type: 'binary_pairing',
      amount: 200,
    }),
    /not fully funded/i,
  )
  assert.equal(walletCredits, 0)
})

test('a fully funded binary commission reaches the protected ledger exactly once', async () => {
  let rawQueryCount = 0
  const tx = {
    $queryRaw: async () => {
      rawQueryCount += 1
      if (rawQueryCount === 1) return [{ id: 'fully-funded-binary' }]
      if (rawQueryCount === 2) return [{ funded_amount: '200.00', unfunded_amount: '0.00' }]
      return [{ id: 'ledger-a', balance_delta: '200.00', total_earned_delta: '200.00' }]
    },
  } as unknown as Prisma.TransactionClient

  const result = await creditCommissionExactlyOnce(tx, {
    eventKey: 'upgrade:pin-b:binary:user-a:payable',
    sourceEventKind: 'upgrade',
    sourceEventId: 'pin-b',
    ruleVersion: 'package-binary-v1',
    userId: 'user-a',
    type: 'binary_pairing',
    amount: 200,
  })

  assert.equal(result.credited, true)
  assert.equal(rawQueryCount, 3)
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

test('the database serializes reserve consumption and aborts on any shortfall', () => {
  const migration = readFileSync(
    'prisma/migrations/20260901170000_enforce_funded_binary_commissions/migration.sql',
    'utf8',
  )
  const helper = readFileSync('src/app/lib/commissionCredit.ts', 'utf8')

  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('binary-reserve-funding'\)\)/)
  assert.match(migration, /Historical unfunded binary commissions require reconciliation/)
  assert.match(migration, /IF available < NEW\."amount" THEN[\s\S]*RAISE EXCEPTION/)
  assert.match(migration, /ORDER BY "allocated_at" ASC, "id" ASC[\s\S]*FOR UPDATE\s+LIMIT 1/)
  assert.doesNotMatch(migration, /SKIP LOCKED/)
  assert.match(helper, /assertBinaryCommissionIsFullyFunded[\s\S]*assertCommissionWalletCredit/)
  assert.doesNotMatch(helper, /tx\.wallet\.(?:update|upsert)/)
})

test('binary cascades preflight all member-payable liability and retain flashout outside reserve', () => {
  const source = readFileSync('src/app/lib/binaryCommission.ts', 'utf8')
  const migration = readFileSync(
    'prisma/migrations/20260902120000_harden_binary_settlement_and_payouts/migration.sql',
    'utf8',
  )
  const aggregate = source.indexOf('const totalPayable = plans.reduce')
  const reserveLock = source.indexOf("pg_advisory_xact_lock(hashtext('binary-reserve-funding'))", aggregate)
  const reserveCheck = source.indexOf('toCentavos(availableAmount) < toCentavos(totalPayable)', reserveLock)
  const firstCredit = source.indexOf('await creditCommissionExactlyOnce', reserveCheck)

  assert.ok(aggregate >= 0 && aggregate < reserveLock)
  assert.ok(reserveLock < reserveCheck && reserveCheck < firstCredit)
  assert.match(source, /await recordCommissionExactlyOnce\(tx,[\s\S]*isOverflow: true/)
  assert.match(
    migration,
    /OR NEW\."is_pair_overflow" = true THEN[\s\S]*RETURN NEW/,
  )
})

test('binary volume and pair audit rows are independently unique per source event', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const migration = readFileSync(
    'prisma/migrations/20260902120000_harden_binary_settlement_and_payouts/migration.sql',
    'utf8',
  )
  const source = readFileSync('src/app/lib/binaryCommission.ts', 'utf8')

  assert.match(
    schema,
    /model BinarySettlementEvent[\s\S]*@@unique\(\[source_kind, source_event_id\]\)/,
  )
  assert.match(
    schema,
    /model BinaryPairEvent[\s\S]*source_event_id[\s\S]*@@unique\(\[source_kind, source_event_id, recipient_user_id\]\)/,
  )
  assert.match(migration, /CREATE UNIQUE INDEX "binary_settlement_events_source_kind_source_event_id_key"/)
  assert.match(source, /priorSettlement[\s\S]*DuplicateBinarySettlementError/)
  assert.match(source, /source_event_id: input\.sourceEventId/)
})

test('deactivation wallet transfers have a dedicated non-binary commission type', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const migration = readFileSync(
    'prisma/migrations/20260901170000_enforce_funded_binary_commissions/migration.sql',
    'utf8',
  )

  assert.match(schema, /binary_pairing\s+deactivation_wallet_transfer/)
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'deactivation_wallet_transfer'/)
})

test('Product Binary retains its existing unique order-level idempotency boundary', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const source = readFileSync('src/app/lib/productBinary.ts', 'utf8')
  assert.match(schema, /model ProductBinaryOrderEvent[\s\S]*order_id\s+String\s+@unique/)
  assert.match(source, /reason: 'already_processed'/)
})
