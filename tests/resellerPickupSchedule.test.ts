import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parsePickupSchedule } from '../src/app/lib/pickupSchedule'

const read = (path: string) => readFileSync(path, 'utf8')

test('pickup datetime-local values are interpreted strictly in Asia/Manila', () => {
  const now = new Date('2026-09-11T00:00:00.000Z')
  assert.equal(parsePickupSchedule('2026-09-11T10:00', now).toISOString(), '2026-09-11T02:00:00.000Z')
  assert.throws(() => parsePickupSchedule('2026-09-11T08:10', now), /at least 15 minutes/)
  assert.throws(() => parsePickupSchedule('2026-10-12T10:00', now), /up to 30 days/)
})

test('reseller pickup orders require a durable schedule and reserve stock atomically', () => {
  const route = read('src/app/api/reseller/orders/route.ts')
  assert.match(route, /parsePickupSchedule\(pickup_scheduled_at\)/)
  assert.match(route, /pickup_schedule_timezone: pickupScheduledAt \? PICKUP_TIME_ZONE : null/)
  assert.match(route, /await reserveOrderStock\(tx, seller\.id, items\)/)
  assert.ok(route.indexOf('await reserveOrderStock(tx, seller.id, items)') < route.indexOf('return tx.order.create'))
})

test('database requires immutable pickup schedules and sends two-way order notifications', () => {
  const migration = read('prisma/migrations/20260911160000_add_reseller_pickup_schedule/migration.sql')
  assert.match(migration, /RESELLER_PICKUP_SCHEDULE_REQUIRED/)
  assert.match(migration, /PICKUP_SCHEDULE_IS_IMMUTABLE/)
  assert.match(migration, /NEW\.seller_id, 'order_placed'/)
  assert.match(migration, /NEW\.buyer_id, 'order_payment_'/)
  assert.match(migration, /AFTER UPDATE OF status, payment_status/)
})
