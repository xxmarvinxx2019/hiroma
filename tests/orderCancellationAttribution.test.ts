import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('order cancellation records immutable actor-facing evidence at every commerce entry point', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read(
    'prisma/migrations/20260911130000_add_order_cancellation_audit/migration.sql',
  )
  const helper = read('src/app/lib/orderCancellation.ts')

  for (const field of [
    'cancelled_at',
    'cancelled_by_actor_id',
    'cancelled_by_name',
    'cancelled_by_role',
    'cancellation_reason',
  ]) {
    assert.match(schema, new RegExp(`${field}\\s+`))
    assert.match(migration, new RegExp(`"${field}"`))
  }
  assert.match(helper, /actor\.actor_id \|\| actor\.id/)
  assert.match(
    helper,
    /actor\.actor_name \|\| actor\.full_name \|\| actor\.username/,
  )

  for (const route of [
    'src/app/api/reseller/orders/route.ts',
    'src/app/api/city/orders/route.ts',
    'src/app/api/provincial/orders/route.ts',
    'src/app/api/regional/orders/route.ts',
    'src/app/api/admin/orders/route.ts',
    'src/app/api/city/pos/approvals/route.ts',
    'src/app/api/city/pos/adjustments/route.ts',
  ]) {
    assert.match(read(route), /buildOrderCancellationEvidence/)
  }
})

test('reseller, outlet, Admin, and shared detail responses expose cancellation attribution', () => {
  for (const route of [
    'src/app/api/reseller/orders/route.ts',
    'src/app/api/city/orders/route.ts',
    'src/app/api/admin/orders/route.ts',
    'src/app/api/orders/[id]/route.ts',
  ]) {
    const source = read(route)
    assert.match(source, /cancelled_by_name: true/)
    assert.match(source, /cancellation_reason: true/)
  }

  assert.match(
    read('src/app/dashboard/reseller/orders/page.tsx'),
    /Cancelled by you/,
  )
  assert.match(
    read('src/app/dashboard/city/orders/CityOrderDetailsModal.tsx'),
    /Cancelled by reseller/,
  )
  assert.match(
    read('src/app/dashboard/admin/orders/page.tsx'),
    /Cancellation attribution unavailable \(legacy order\)/,
  )
})
