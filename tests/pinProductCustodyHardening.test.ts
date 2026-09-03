import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20260903130000_harden_pin_and_product_custody/migration.sql')
const adminPins = read('src/app/api/admin/pins/route.ts')
const pinTransfers = read('src/app/api/pin-transfers/[id]/route.ts')
const pinRequests = read('src/app/api/pin-requests/route.ts')
const adminInventory = read('src/app/api/admin/inventory/route.ts')
const productReceiving = read('src/app/api/inventory/transfers/[id]/route.ts')
const pinSales = read('src/app/api/admin/pins/sales/route.ts')

test('PIN custody has a distinct zero-revenue in-transit source', () => {
  assert.match(schema, /enum PinStatus \{\s+in_transit/)
  assert.match(schema, /model PinTransfer \{/)
  assert.match(schema, /funding_pin_transfer_id\s+String\?/)
  assert.match(migration, /num_nonnulls\([\s\S]*funding_order_id[\s\S]*funding_pin_request_id[\s\S]*funding_pin_transfer_id[\s\S]*\) <> 1/)
  assert.match(migration, /source_transfer\."sale_value" = 0/)
  assert.match(migration, /linked_count = source_transfer\."quantity"/)
  assert.match(migration, /linked_total = source_transfer\."reference_value"/)
})

test('Admin issuance cannot silently turn a Branch transfer or self issuance into a sale', () => {
  assert.match(adminPins, /recipientLevel === 'branch' \? 'internal_transfer' : 'paid_sale'/)
  assert.match(adminPins, /PIN recipient must be an active City Distributor or Hiroma Branch/)
  assert.match(adminPins, /payment_reference: paymentReference/)
  assert.match(adminPins, /payment_evidence_at: paymentEvidenceAt!/)
  assert.match(adminPins, /sale_value: 0/)
  assert.match(adminPins, /status: expectedWorkflow === 'internal_transfer' \? 'in_transit' : 'unused'/)
  assert.match(adminPins, /createRequiredAuditLog\(tx,/)
})

test('Branch receiving is all-or-nothing and only then activates transferred PINs', () => {
  assert.match(pinTransfers, /where: \{ id, recipient_id: user\.id, status: 'in_transit' \}/)
  assert.match(pinTransfers, /where: \{ funding_pin_transfer_id: id, status: 'in_transit' \}/)
  assert.match(pinTransfers, /changedPins\.count !== transfer\.quantity/)
  assert.match(pinTransfers, /\? \{ status: 'unused' \}/)
  assert.match(migration, /PIN transfer batch is incomplete or its custody states are inconsistent/)
  assert.match(migration, /OLD\."status" = 'in_transit'[\s\S]*NEW\."status" IN \('received', 'rejected'\)/)
})

test('paid requests are City-only and record the actual approval actor', () => {
  assert.match(pinRequests, /acquisitionTier === 'branch'/)
  assert.match(pinRequests, /\['gcash', 'bank_transfer'\]\.includes\(paymentMethod\)/)
  assert.match(pinRequests, /generated_by_actor_id: actorId/)
  assert.match(pinRequests, /approvedByActorId: actorId/)
  assert.match(migration, /New PIN requests require an active City Distributor and complete electronic payment evidence/)
})

test('PIN cancellation records one exact disposition per PIN', () => {
  assert.match(adminPins, /\['refunded', 'credited', 'retained'\]\.includes\(cancellationDisposition\)/)
  assert.match(adminPins, /for \(const pin of pins\)/)
  assert.match(adminPins, /cancellation_amount: Number\(pin\.pin_allocation_snapshot \|\| 0\)/)
  assert.match(migration, /A cancelled PIN requires complete immutable financial disposition evidence/)
})

test('Admin stock increases require append-only source-backed receipt evidence', () => {
  assert.match(schema, /model AdminStockReceipt \{/)
  assert.match(schema, /model AdminStockReceiptItem \{/)
  assert.match(adminInventory, /\['production', 'supplier_purchase', 'approved_adjustment'\]\.includes\(sourceType\)/)
  assert.match(adminInventory, /tx\.adminStockReceipt\.create/)
  assert.match(adminInventory, /tx\.adminStockReceiptItem\.create/)
  assert.match(adminInventory, /createRequiredAuditLog\(tx,/)
  assert.match(migration, /Admin stock receipt evidence is append-only/)
  assert.match(migration, /Admin stock receipt header does not match its item quantities/)
  assert.match(schema, /@@unique\(\[admin_id, source_type, source_reference_key\], map: "admin_stock_receipts_source_reference_key"\)/)
  assert.match(migration, /CONSTRAINT "admin_stock_receipts_source_reference_key"[\s\S]*UNIQUE \("admin_id", "source_type", "source_reference_key"\)/)
  assert.match(adminInventory, /sourceReference\.replace\(\/\\s\+\/g, ' '\)\.toUpperCase\(\)/)
})

test('product receiving permits one legitimate stock-after update then seals it', () => {
  assert.match(migration, /OLD\."received_at" IS NULL/)
  assert.match(migration, /NEW\."received_at" IS NULL AND NEW\."recipient_stock_after" IS DISTINCT FROM OLD\."recipient_stock_after"/)
  assert.match(migration, /Inventory receiving evidence is immutable after receipt/)
  assert.match(productReceiving, /received_by_actor_id: actorId/)
  assert.match(productReceiving, /createRequiredAuditLog\(tx,/)
})

test('PIN reporting uses paid issuance time and separates internal transfers from revenue', () => {
  assert.match(pinSales, /financial_purpose: 'pin_sale'/)
  assert.match(pinSales, /payment_status: 'paid'/)
  assert.match(pinSales, /paid_at: \{ gte: period\.start, lt: period\.end \}/)
  assert.match(pinSales, /internalTransfers/)
  assert.match(pinSales, /internalTransferTotals\._count\.id/)
  assert.match(pinSales, /internal_transfer_revenue: Number\(internalTransferTotals\._sum\.sale_value \|\| 0\)/)
  assert.doesNotMatch(pinSales, /internal_transfer_count:\s*internalTransfers\.length/)
  assert.doesNotMatch(pinSales, /notes: \{ contains: 'PIN sale' \}/)
  assert.doesNotMatch(pinSales, /used_at: \{ gte: period\.start/)
})
