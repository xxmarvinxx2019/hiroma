import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { firstCityStaffRoute } from '../src/app/lib/staffPermissions'

const read = (path: string) => readFileSync(path, 'utf8')

test('POS maker and approver permissions are separate', () => {
  const permissions = read('src/app/lib/staffPermissions.ts')
  const middleware = read('src/proxy.ts')
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
  assert.match(layout, /Sync Center[\s\S]*?\/dashboard\/city\/pos\/sync/)
  assert.match(layout, /["']\/dashboard\/city\/pos\/sync["']:\s*["']pos["']/)
  assert.match(sync, /listQueuedSales/)
  assert.match(sync, /Retry sync/)
  assert.match(sync, /Sync now/)
  assert.match(sync, /async function syncNow/)
  assert.match(sync, /for \(let index = 0; index < pending\.length; index \+= 1\)/)
  assert.match(sync, /await synchronizeSale\(sale\)/)
  assert.match(sync, /Sync check complete/)
  assert.match(sync, /Checking device and server/)
  assert.match(sync, /Processing \$\{syncProgress\.processed \+ 1\} of/)
  assert.match(sync, /Synchronization successful/)
  assert.match(sync, /Synchronization failed/)
  assert.match(sync, /role="dialog"/)
  assert.match(sync, /aria-labelledby="sync-progress-title"/)
  assert.match(sync, /Secure synchronization/)
  assert.match(sync, /Please wait/)
  assert.match(sync, /setSyncModalOpen\(true\)/)
  assert.match(sync, /progressPercent/)
  assert.match(sync, /window\.setTimeout\(resolve, 2800\)/)
  assert.match(sync, /setInterval/)
  assert.match(sync, /Math\.min\(90, current \+ 2\)/)
  assert.match(sync, /Math\.min\(99,\s*90 \+ Math\.round/)
  assert.match(sync, /setDisplayProgress\(0\)/)
  assert.match(sync, /role="progressbar"/)
  assert.match(sync, /linear-gradient\(90deg, #071638 0%, #0369a1 55%, #38bdf8 100%\)/)
  assert.match(sync, /This device is up to date/)
  assert.match(sync, /syncProgress\.phase === "success" && syncProgress\.total > 0/)
  assert.doesNotMatch(sync, /queue\.length === 0 \|\| Boolean\(retrying\)/)
  assert.match(sync, /Running sales and expected cash are intentionally hidden/)
  assert.doesNotMatch(sync, /expected_cash_snapshot|total_snapshot|payment_groups/)
})

test('POS appearance follows the device or a saved light and dark preference', () => {
  const settings = read('src/app/dashboard/city/pos/settings/page.tsx')
  const layout = read('src/app/dashboard/city/layout.tsx')
  const appearance = read('src/app/lib/posAppearance.ts')
  const globals = read('src/app/globals.css')

  assert.match(settings, /Use device settings/)
  assert.match(settings, /Manual theme/)
  assert.match(settings, /\["light", "dark"\]/)
  assert.match(settings, /savePosAppearance/)
  assert.match(appearance, /hiroma-pos-appearance-v1/)
  assert.match(layout, /prefers-color-scheme/)
  assert.match(layout, /data-pos-theme=/)
  assert.match(layout, /resolvePosTheme/)
  assert.match(globals, /\[data-pos-theme="dark"\]/)
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
  const page = read('src/app/components/pos/PosCloseShiftModal.tsx')
  assert.match(shifts, /body\.cash_explanation/)
  assert.match(shifts, /body\.inventory_explanation/)
  assert.match(shifts, /missingCashExplanation/)
  assert.match(shifts, /missingInventoryExplanation/)
  assert.match(shifts, /required_explanations:\s*\{\s*cash: result\.cash,\s*inventory: result\.inventory,?\s*\}/)
  assert.match(page, /Cash recount explanation/)
  assert.match(page, /Inventory recount explanation/)
  assert.match(page, /cash_explanation:\s*cn/)
  assert.match(page, /inventory_explanation:\s*inote/)
  assert.match(page, /b\.code\s*===\s*["'']SHIFT_EXPLANATION_REQUIRED["'']/)
  assert.match(page, /b\.required_explanations\?\.cash/)
  assert.match(page, /b\.required_explanations\?\.inventory/)
})


test('registration payment approvals use the shared Approval Center shell', () => {
  const page = read('src/app/dashboard/city/pos/registration-approvals/page.tsx')
  assert.match(page, /Registration payment control/)
  assert.match(page, /before releasing the registration for encoding/)
  assert.match(page, /Return to POS/)
  assert.match(page, /Registration payments awaiting review/)
  assert.match(page, /min-h-full bg-\[#f4f6fb\]/)
})


test('Approval Center tabs exclude the dedicated Void and Refunds module', () => {
  const pages = [
    read('src/app/dashboard/city/pos/approvals/page.tsx'),
    read('src/app/dashboard/city/pos/registration-approvals/page.tsx'),
    read('src/app/dashboard/city/pos/shift-approvals/page.tsx'),
  ]
  for (const page of pages) {
    assert.match(page, /sm:grid-cols-3/)
    assert.doesNotMatch(page, /dashboard\/city\/pos\/adjustments/)
    assert.doesNotMatch(page, /Void & Refunds/)
  }
})

test("shift payment summary separates approved non-cash from pending verification", () => {
  const transactions = read("src/app/api/city/pos/transactions/route.ts")
  assert.match(transactions, /pending_count/)
  assert.match(transactions, /row.status === 'synced_pending_review'/)
  assert.match(transactions, /\['rejected', 'voided'\]\.includes\(row\.status\)/)
  assert.match(transactions, /group\.method\.toLowerCase\(\) === 'cash' && !closed/)
})

test('returned POS payments notify the exact cashier and can be safely corrected and resubmitted', () => {
  const approvals = read('src/app/api/city/pos/approvals/route.ts')
  const adjustments = read('src/app/api/city/pos/adjustments/route.ts')
  const page = read('src/app/dashboard/city/pos/adjustments/page.tsx')

  assert.match(approvals, /action !== 'approve'/)
  assert.match(approvals, /correction or rejection reason of at least 5 characters/i)
  assert.match(approvals, /pos_payment_needs_correction/)
  assert.match(approvals, /user_id:\s*transaction\.cashier_id/)
  assert.match(approvals, /export async function PUT/)
  assert.match(approvals, /cashier_id:\s*actorId/)
  assert.match(approvals, /status:\s*'needs_correction'/)
  assert.match(approvals, /status:\s*'pending_sync'/)
  assert.match(approvals, /payment_correction_resubmitted/)
  assert.match(adjustments, /review_notes/)
  assert.match(page, /Manager note/)
  assert.match(page, /Correct payment reference/)
  assert.match(page, /Resubmit for manager review/)
})
