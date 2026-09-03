import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const migration = read('../prisma/migrations/20260902152000_bind_product_binary_to_paid_orders/migration.sql')
const processor = read('../src/app/lib/productBinary.ts')

test('legacy jobs disarm the old deferred completion trigger before reconciliation', () => {
  const dropTrigger = migration.indexOf(
    'DROP TRIGGER IF EXISTS "product_binary_jobs_validate_completion"',
  )
  const reconcileJobs = migration.indexOf('UPDATE "product_binary_settlement_jobs"')
  const createTrigger = migration.indexOf(
    'CREATE CONSTRAINT TRIGGER "product_binary_jobs_validate_completion"',
  )

  assert.ok(dropTrigger >= 0 && dropTrigger < reconcileJobs)
  assert.ok(reconcileJobs >= 0 && reconcileJobs < createTrigger)
})

test('inventory movements cannot mint Product Binary reserve', () => {
  assert.match(migration, /DROP TRIGGER IF EXISTS "inventory_movement_create_product_binary_funding"/)
  assert.doesNotMatch(migration, /AFTER INSERT ON "inventory_movements"[\s\S]*create_product_binary_funding_lot/)
  assert.match(migration, /legacy_movement_quarantined/)
  assert.match(migration, /"remaining_amount" = 0/)
  assert.match(migration, /inventory_movements_seal_financial_identity/)
})

test('new order items receive complete database-authored immutable Product Binary snapshots', () => {
  assert.match(migration, /CREATE TRIGGER "order_items_snapshot_product_binary"[\s\S]*BEFORE INSERT/)
  assert.match(migration, /NEW\."binary_eligible_snapshot" :=/)
  assert.match(migration, /NEW\."pu_value_snapshot" :=/)
  assert.match(migration, /NEW\."company_unit_cost_snapshot" :=/)
  assert.match(migration, /NEW\."company_unit_margin_snapshot" :=/)
  assert.match(migration, /NEW\."snapshot_source" := 'product-binary-order-v1'/)
  assert.match(migration, /order_items_seal_product_binary/)
})

test('only paid delivered commerce orders become qualified jobs and admin funding lots', () => {
  assert.match(
    migration,
    /LOCK TABLE "commissions", "inventory_movements", "order_items", "orders",[\s\S]*"users"\s+IN SHARE ROW EXCLUSIVE MODE;/,
  )
  assert.match(migration, /source_order\.order_status <> 'delivered'/)
  assert.match(migration, /source_order\.financial_purpose <> 'commerce'/)
  assert.match(migration, /source_order\.payment_status IS DISTINCT FROM 'paid'/)
  assert.match(migration, /target_status := 'waiting_payment'/)
  assert.match(migration, /target_status := 'reconciliation_required'/)
  assert.match(migration, /DROP TRIGGER IF EXISTS "orders_enqueue_product_binary_settlement"/)
  assert.match(migration, /product_binary_settlement_jobs_status_check[\s\S]*waiting_payment[\s\S]*reconciliation_required/)
  assert.match(migration, /target_qualification := 'ineligible_zero_pu'/)
  assert.match(migration, /source_order\.seller_role = 'admin'/)
  assert.match(migration, /'paid-delivered-admin-order'/)
  assert.match(migration, /LEAST\(GREATEST\(0, company_gross_margin\), eligible_units \* 20\.00\)/)
  assert.match(migration, /CREATE TRIGGER "product_binary_funding_lots_validate_source"[\s\S]*BEFORE INSERT/)
  assert.match(migration, /Product Binary funding lot does not match one exact paid-delivered Admin order/)
  assert.match(migration, /CREATE TRIGGER "product_binary_jobs_validate_source"[\s\S]*BEFORE INSERT OR UPDATE/)
  assert.match(migration, /Product Binary settlement job does not match one exact paid-delivered reseller order/)
})

test('positive PU settlement reads only sealed job snapshots and binds the exact job event', () => {
  assert.match(processor, /FROM product_binary_settlement_jobs/)
  assert.match(processor, /job\.snapshot_version !== 'product-binary-order-v1'/)
  assert.doesNotMatch(processor, /JOIN products p ON p\.id=oi\.product_id/)
  assert.doesNotMatch(processor, /p\.binary_eligible/)
  assert.match(processor, /recorded_gross_margin,settlement_job_id/)
  assert.match(migration, /Positive-PU completed job must bind one exact snapshotted order event/)
  assert.match(migration, /NEW\."processed_at" := transaction_timestamp\(\)/)
  assert.match(migration, /Product Binary funding-lot balance does not reconcile to append-only consumption/)
})

test('legacy and zero-PU orders are explicit instead of inferred or fabricated', () => {
  assert.match(migration, /legacy_snapshot_reconciliation/)
  assert.match(migration, /Legacy delivered order has no database-authored Product Binary snapshot/)
  assert.match(migration, /CASE WHEN source_order\.payment_status = 'paid' AND exact_item_count = item_count/)
  assert.match(migration, /target_qualification := 'ineligible_zero_pu'/)
  assert.match(migration, /Auditable zero-PU job cannot claim a Product Binary order event/)
  const reserveRoute = read('../src/app/api/admin/commission-testing/reserve-ledger/route.ts')
  assert.match(reserveRoute, /qualification_status NOT IN \('qualified_paid_delivery','ineligible_zero_pu'\)/)
  assert.match(reserveRoute, /GROUP BY status,qualification_status/)
})

test('Admin stock assignment stays unpaid and cannot immediately settle Product Binary', () => {
  const route = read('../src/app/api/admin/inventory/route.ts')
  assert.match(route, /A stock assignment records delivery, not payment/)
  assert.match(route, /PRODUCT_BINARY_WAITING_PAYMENT_WARNING/)
  assert.doesNotMatch(route, /processDeliveredProductBinaryOrder\(order\.id\)/)
})
