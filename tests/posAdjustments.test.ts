import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

test('POS adjustment schema supports multiple immutable item-level refund requests', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260827234000_add_partial_pos_refunds/migration.sql')
  assert.match(schema, /model PosAdjustmentItem/)
  assert.match(schema, /adjustment_requests\s+PosAdjustmentRequest\[\]/)
  const adjustmentModel = schema.slice(schema.indexOf('model PosAdjustmentRequest'), schema.indexOf('model PosAdjustmentItem'))
  assert.doesNotMatch(adjustmentModel, /pos_transaction_id\s+String\s+@unique/)
  assert.match(migration, /DROP INDEX.*pos_adjustment_requests_pos_transaction_id_key/i)
  assert.match(migration, /CREATE TABLE "pos_adjustment_items"/)
  assert.match(migration, /CHECK \("quantity" > 0\)/)
  assert.match(migration, /resellable.*damaged.*expired/)
})

test('partial refunds reserve quantities atomically and reject over-refunds', () => {
  const route = read('src/app/api/city/pos/adjustments/route.ts')
  assert.match(route, /TransactionIsolationLevel\.Serializable/)
  assert.match(route, /status: \{ in: \['pending', 'approved'\] \}/)
  assert.match(route, /row\.quantity > item\.quantity - \(reserved\.get\(item\.id\) \|\| 0\)/)
  assert.match(route, /POS_REFUND_QUANTITY_EXCEEDED/)
  assert.match(route, /POS_DUPLICATE_REFUND_ITEM/)
  assert.match(route, /error\.code === 'P2034'/)
})

test('approval preserves maker-approver control and only restocks resellable returns', () => {
  const route = read('src/app/api/city/pos/adjustments/route.ts')
  assert.match(route, /request\.requested_by_id === actorId/)
  assert.match(route, /status: 'pending'/)
  assert.match(route, /row\.disposition === 'resellable' \? row\.quantity : 0/)
  assert.match(route, /quantity: \{ increment: restock \}/)
  assert.match(route, /disposition: row\.disposition/)
  assert.match(route, /pos_refund_\$\{row\.disposition\}/)
  assert.match(route, /if \(fullyReversed\)/)
})

test('member POS reversals remain locked by permanent Hiroma refund policy', () => {
  const route = read('src/app/api/city/pos/adjustments/route.ts')
  assert.match(route, /transaction\.transaction_type !== 'non_member_sale'/)
  assert.match(route, /POS_MEMBER_REVERSAL_LOCKED/)
  assert.match(route, /Member and reseller sales remain final/)
})

test('member receipts clearly disclose the non-refundable policy', () => {
  const adjustments = read('src/app/dashboard/city/pos/adjustments/page.tsx')
  const receipt = read('src/app/dashboard/city/pos/page.tsx')
  assert.match(adjustments, /Member\/Reseller sale .* Not eligible for void or refund/)
  assert.match(receipt, /Member\/Reseller purchase .* Not eligible for void or refund/)
})

test('cashier receipt UI supports product, quantity, and condition selection', () => {
  const page = read('src/app/dashboard/city/pos/adjustments/page.tsx')
  const route = read('src/app/api/city/pos/adjustments/route.ts')
  assert.match(page, /Select returned products and quantities/)
  assert.match(page, /aria-label="What is Void\?"/)
  assert.match(page, /aria-label="What is Refund\?"/)
  assert.match(page, /Void cancels the entire receipt/)
  assert.match(page, /Refund records a customer return/)
  assert.match(page, /available to refund/)
  assert.match(page, /Refund qty/)
  assert.match(page, /Resellable/)
  assert.match(page, /Damaged/)
  assert.match(page, /Expired/)
  assert.match(page, /max=\{item\.refundable_quantity\}/)
  assert.match(route, /refundable_quantity: Math\.max\(0, item\.quantity - reserved\)/)
  assert.match(route, /transaction_item: \{ select: \{ product_name_snapshot: true \} \}/)
  assert.match(page, /Only resellable items return to sellable inventory/)
  assert.match(page, /item\.transaction_item\.product_name_snapshot/)
})

test('receipts distinguish device-only transactions from manager-visible synced records', () => {
  const page = read('src/app/dashboard/city/pos/adjustments/page.tsx')
  const route = read('src/app/api/city/pos/adjustments/route.ts')
  assert.match(page, /listQueuedSales/)
  assert.match(page, /Pending sync/)
  assert.match(page, /Syncing/)
  assert.match(page, /Synced/)
  assert.match(page, /Needs attention/)
  assert.match(page, /Visible to manager/)
  assert.match(page, /Correction requests become available after synchronization/)
  assert.match(route, /client_transaction_id: true/)
  assert.match(route, /server_received_at: true/)
})

test('approved partial refunds reduce shift reporting and expected cash only', () => {
  const inventory = read('src/app/api/city/inventory/route.ts')
  const shifts = read('src/app/api/city/pos/shifts/route.ts')
  const transactions = read('src/app/api/city/pos/transactions/route.ts')
  assert.match(inventory, /status: 'approved', request_type: 'refund'/)
  assert.match(inventory, /netShiftAmount/)
  assert.match(shifts, /approvedCashRefunds/)
  assert.match(shifts, /-\s*Number\(approvedCashRefunds\._sum\.amount_snapshot \|\| 0\)/)
  assert.match(transactions, /refunded_amount/)
  assert.match(transactions, /net_total/)
})

test('POS adjustment routes retain cashier and approver permissions', () => {
  const middleware = read('src/proxy.ts')
  const layout = read('src/app/dashboard/city/layout.tsx')
  assert.match(middleware, /pos\/adjustments[\s\S]*return 'pos\|pos_approve'/)
  assert.match(layout, /Receipts/)
  assert.doesNotMatch(layout, /label:\s*["'']Void & Refunds["'']/)
  assert.match(layout, /["']\/dashboard\/city\/pos\/adjustments["']:\s*["']pos\|pos_approve["']/)
})
