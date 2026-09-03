import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import { claimPendingPinRequestAndCreatePins } from '../src/app/lib/pinRequestApproval'

test('a concurrent approval loser cannot create another PIN batch', async () => {
  let pinBatchWrites = 0
  const tx = {
    pinRequest: {
      updateMany: async () => ({ count: 0 }),
    },
    pin: {
      createMany: async () => {
        pinBatchWrites += 1
        return { count: 1 }
      },
    },
  } as unknown as Prisma.TransactionClient

  const approved = await claimPendingPinRequestAndCreatePins(tx, {
    requestId: 'request-a',
    pins: [{
      pin_code: 'HRM-2026-STA-10000',
      package_id: 'package-a',
      city_dist_id: 'city-a',
      status: 'unused',
      generated_by: 'admin-a',
    }],
    registrationProducts: [],
    updatedAt: new Date('2026-09-02T00:00:00.000Z'),
    approvedByActorId: '00000000-0000-4000-8000-000000000001',
  })

  assert.equal(approved, false)
  assert.equal(pinBatchWrites, 0)
})

test('the pending claim precedes the complete PIN batch write', async () => {
  const operations: string[] = []
  const tx = {
    pinRequest: {
      updateMany: async (args: { where: { status: string } }) => {
        operations.push(`claim:${args.where.status}`)
        return { count: 1 }
      },
    },
    pin: {
      createMany: async (args: { data: unknown[] }) => {
        operations.push(`pins:${args.data.length}`)
        return { count: args.data.length }
      },
      findMany: async () => {
        operations.push('pins:readback')
        return [{ id: 'pin-a' }, { id: 'pin-b' }]
      },
    },
    pinRegistrationProductSnapshot: {
      createMany: async (args: { data: unknown[] }) => {
        operations.push(`snapshots:${args.data.length}`)
        return { count: args.data.length }
      },
    },
  } as unknown as Prisma.TransactionClient

  const approved = await claimPendingPinRequestAndCreatePins(tx, {
    requestId: 'request-b',
    paymentStatus: 'paid',
    pins: [
      { pin_code: 'HRM-2026-STA-10001', package_id: 'package-a', city_dist_id: 'city-a', status: 'unused', generated_by: 'admin-a' },
      { pin_code: 'HRM-2026-STA-10002', package_id: 'package-a', city_dist_id: 'city-a', status: 'unused', generated_by: 'admin-a' },
    ],
    registrationProducts: [{
      product_id: 'product-a',
      quantity: 10,
      srp_snapshot: 249,
      reseller_price_snapshot: 183,
      unit_acquisition_cost_snapshot: 163,
    }],
    updatedAt: new Date('2026-09-02T00:00:00.000Z'),
    approvedByActorId: '00000000-0000-4000-8000-000000000001',
  })

  assert.equal(approved, true)
  assert.deepEqual(operations, ['claim:pending', 'pins:2', 'pins:readback', 'snapshots:2'])
})

test('the route wraps the approval claim and PIN batch in one transaction', () => {
  const route = readFileSync('src/app/api/pin-requests/route.ts', 'utf8')

  assert.match(route, /prisma\.\$transaction\(async \(tx\) =>/)
  assert.match(route, /assessPinIssuanceAgainstBinaryReserve\(/)
  assert.match(route, /claimPendingPinRequestAndCreatePins\(tx,/)
  assert.doesNotMatch(route, /prisma\.pin\.createMany/)
})
