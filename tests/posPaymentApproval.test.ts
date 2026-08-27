import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { firstCityStaffRoute } from '../src/app/lib/staffPermissions'

const read = (path: string) => readFileSync(path, 'utf8')

test('POS maker and approver permissions are separate', () => {
  const permissions = read('src/app/lib/staffPermissions.ts')
  const middleware = read('src/middleware.ts')
  assert.match(permissions, /key: 'pos_approve'/)
  assert.match(middleware, /pos\/approvals[\s\S]*return 'pos_approve'/)
  assert.match(middleware, /pos\/shift-approvals[\s\S]*return 'pos_approve'/)
})

test('restricted city staff are redirected to their first permitted workspace', () => {
  assert.equal(firstCityStaffRoute(['pos', 'inventory']), '/dashboard/city/pos')
  assert.equal(firstCityStaffRoute(['inventory', 'reports', 'pos_approve']), '/dashboard/city/pos/approvals')
  assert.equal(firstCityStaffRoute([]), '/login/distributor')
})

test('non-cash POS sales wait for independent payment verification', () => {
  const transactions = read('src/app/api/city/pos/transactions/route.ts')
  assert.match(transactions, /requiresApproval \? 'synced_pending_review' : 'finalized'/)
  assert.match(transactions, /requiresApproval \? 'pending_verification' : 'paid'/)
  assert.match(transactions, /POS_PAYMENT_REFERENCE_DUPLICATE/)
})

test('offline POS checkout is cash-only in both the client and server', () => {
  const page = read('src/app/dashboard/city/pos/page.tsx')
  const transactions = read('src/app/api/city/pos/transactions/route.ts')
  const bootstrap = read('src/app/api/city/pos/bootstrap/route.ts')
  assert.match(page, /setPaymentMethod\("cash"\)/)
  assert.match(page, /captured_offline: !online/)
  assert.match(page, /disabled=\{!online\}/)
  assert.match(page, /Offline mode: Cash only\./)
  assert.match(transactions, /capturedOffline && paymentSelection !== 'cash'/)
  assert.match(transactions, /OFFLINE_CASH_ONLY/)
  assert.match(bootstrap, /payment_methods: \['cash'\]/)
})

test('POS visibly identifies the authenticated cashier', () => {
  const page = read('src/app/dashboard/city/pos/page.tsx')
  const bootstrap = read('src/app/api/city/pos/bootstrap/route.ts')
  assert.match(bootstrap, /full_name: user\.actor_name \|\| user\.full_name/)
  assert.match(bootstrap, /username: user\.actor_username \|\| user\.username/)
  assert.match(page, /Logged-in cashier/)
  assert.match(page, /cashier_name: data\.cashier\.full_name/)
})

test('POS member pricing requires a fresh Digital ID QR proof', () => {
  const page = read('src/app/dashboard/city/pos/page.tsx')
  const transactions = read('src/app/api/city/pos/transactions/route.ts')
  assert.match(page, /Scan Digital ID QR/)
  assert.match(page, /scan_proof: customerType === "member" \? memberScanProof : null/)
  assert.match(page, /Boolean\(selectedMember && memberScanProof\)/)
  assert.match(transactions, /customerType === 'member' && \(!memberId \|\| !scanProof\)/)
  assert.match(transactions, /await consumeWalkInScanProof\(tx, scanProof, user\.id, member\.id\)/)
  assert.match(transactions, /POS_MEMBER_SCAN_REQUIRED/)
})

test('POS product barcode is admin-controlled, unique, and scan-to-add', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260826093000_add_product_barcode/migration.sql')
  const products = read('src/app/api/admin/products/route.ts')
  const bootstrap = read('src/app/api/city/pos/bootstrap/route.ts')
  const page = read('src/app/dashboard/city/pos/page.tsx')
  assert.match(schema, /barcode\s+String\?\s+@unique/)
  assert.match(migration, /CREATE UNIQUE INDEX "products_barcode_key"/)
  assert.match(products, /normalizedBarcode/)
  assert.match(products, /barcode:\s+officialBarcode/)
  assert.match(bootstrap, /barcode: row\.product\.barcode/)
  assert.match(page, /Scan product barcode/)
  assert.match(page, /addProductByBarcode/)
})

test('cashier navigation exposes a POS-only sync center without financial totals', () => {
  const layout = read('src/app/dashboard/city/layout.tsx')
  const sync = read('src/app/dashboard/city/pos/sync/page.tsx')
  assert.match(layout, /Sync Center.*\/dashboard\/city\/pos\/sync/)
  assert.match(layout, /'\/dashboard\/city\/pos\/sync': 'pos'/)
  assert.match(sync, /listQueuedSales/)
  assert.match(sync, /Retry sync/)
  assert.match(sync, /Running sales and expected cash are intentionally hidden/)
  assert.doesNotMatch(sync, /expected_cash_snapshot|total_snapshot|payment_groups/)
})

test('approver cannot review their own payment and rejection restores reserved stock', () => {
  const approvals = read('src/app/api/city/pos/approvals/route.ts')
  assert.match(approvals, /transaction\.cashier_id === actorId/)
  assert.match(approvals, /POS_SELF_APPROVAL/)
  assert.match(approvals, /quantity: \{ increment: item\.quantity \}/)
  assert.match(approvals, /payment_status: 'rejected'/)
})

test('payment account and reference are unique together', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260825170000_add_pos_payment_approval/migration.sql')
  assert.match(schema, /@@unique\(\[payment_method_id, payment_reference\]\)/)
  assert.match(migration, /pos_transactions_payment_method_id_payment_reference_key/)
})

test('shift recount explanations are required per mismatched category', () => {
  const shifts = read('src/app/api/city/pos/shifts/route.ts')
  const page = read('src/app/dashboard/city/pos/page.tsx')
  assert.match(shifts, /body\.cash_explanation/)
  assert.match(shifts, /body\.inventory_explanation/)
  assert.match(shifts, /missingCashExplanation/)
  assert.match(shifts, /missingInventoryExplanation/)
  assert.match(shifts, /required_explanations: \{ cash: result\.cash, inventory: result\.inventory \}/)
  assert.match(page, /Cash recount explanation/)
  assert.match(page, /Inventory recount explanation/)
  assert.match(page, /cash_explanation: cashRecountExplanation/)
  assert.match(page, /inventory_explanation: inventoryRecountExplanation/)
  assert.match(page, /result\.code === "SHIFT_EXPLANATION_REQUIRED"/)
  assert.match(page, /result\.required_explanations\?\.cash === true/)
  assert.match(page, /result\.required_explanations\?\.inventory === true/)
})
