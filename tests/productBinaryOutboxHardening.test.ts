import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

test('Product Binary cron atomically leases due obligations', () => {
  const cron = read('../src/app/api/cron/process-product-binary/route.ts')

  assert.match(cron, /WITH due_jobs AS/)
  assert.match(cron, /FOR UPDATE SKIP LOCKED/)
  assert.match(cron, /UPDATE product_binary_settlement_jobs AS jobs/)
  assert.match(cron, /next_attempt_at = CURRENT_TIMESTAMP \+ INTERVAL '2 minutes'/)
  assert.match(cron, /RETURNING jobs\.order_id/)
})

test('temporary Vercel Hobby schedule is daily and the Pro cutover is tracked', () => {
  const vercel = JSON.parse(read('../vercel.json')) as {
    crons: Array<{ path: string; schedule: string }>
  }
  const rollout = read('../docs/financial-hardening-rollout.md')
  const worker = vercel.crons.find(
    (cron) => cron.path === '/api/cron/process-product-binary',
  )

  assert.equal(worker?.schedule, '0 16 * * *')
  assert.match(rollout, /Temporary Vercel Hobby preview schedule/)
  assert.match(rollout, /restore `\*\/5 \* \* \* \*`/)
})

test('Product Binary failures use bounded exponential retry and remain durable', () => {
  const processor = read('../src/app/lib/productBinary.ts')
  const migration = read('../prisma/migrations/20260902140000_add_financial_ledger_boundary/migration.sql')

  assert.match(processor, /status='failed',attempts=attempts\+1,last_error=/)
  assert.match(processor, /power\(2, LEAST\(attempts, 7\)\)/)
  assert.match(processor, /PRODUCT_BINARY_RETRY_MAX_SECONDS/)
  assert.match(migration, /Product Binary settlement obligations cannot be deleted/)
  assert.match(migration, /OLD\."status" = 'completed' AND NEW\."status" <> 'completed'/)
})

test('settlement retains independent order-level idempotency barriers', () => {
  const processor = read('../src/app/lib/productBinary.ts')
  const accounting = read('../prisma/migrations/20260809023000_product_binary_accounting/migration.sql')

  assert.match(processor, /pg_advisory_xact_lock\(hashtext\(/)
  assert.match(processor, /WHERE order_id = \$\{orderId\} LIMIT 1/)
  assert.match(processor, /status='completed'/)
  assert.match(accounting, /"order_id" TEXT NOT NULL UNIQUE/)
})

test('live fulfillment routes expose queued rewards without settling unpaid stock assignments', () => {
  const routes = [
    read('../src/app/api/admin/orders/route.ts'),
    read('../src/app/api/city/orders/route.ts'),
    read('../src/app/api/admin/inventory/route.ts'),
    read('../src/app/api/city/orders/reseller-orders/route.ts'),
  ]

  for (const route of routes.slice(0, 2).concat(routes.slice(3))) {
    assert.match(route, /reportPendingProductBinarySettlement/)
    assert.match(route, /rewards_pending:/)
    assert.match(route, /rewards_warning/)
  }

  assert.match(routes[2], /PRODUCT_BINARY_WAITING_PAYMENT_WARNING/)
  assert.doesNotMatch(routes[2], /processDeliveredProductBinaryOrder\(order\.id\)/)
  assert.match(routes[2], /const rewardsPending = owner\.role === 'reseller'/)

  const processor = read('../src/app/lib/productBinary.ts')
  assert.match(processor, /activity_type: 'product_binary_settlement_queued'/)
  assert.match(processor, /durable_settlement_job: true/)
})
