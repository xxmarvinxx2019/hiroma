import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const posPage = fs.readFileSync('src/app/dashboard/city/pos/page.tsx', 'utf8')
const installControl = fs.readFileSync('src/app/components/pos/PosInstallControl.tsx', 'utf8')
const manifest = fs.readFileSync('src/app/manifest.ts', 'utf8')
const settingsPage = fs.readFileSync('src/app/dashboard/city/pos/settings/page.tsx', 'utf8')

test('POS provides camera-based Digital ID and product scanning with clear fallbacks', () => {
  assert.match(posPage, /facingMode: "environment"/)
  assert.match(posPage, /Scan Digital ID QR/)
  assert.match(posPage, /Scan product barcode/)
  assert.match(posPage, /Allow camera access and try again/)
  assert.match(posPage, /USB\/Bluetooth barcode scanner or enter the code below/)
})

test('POS checkout and dialogs adapt from phones to larger screens', () => {
  assert.match(posPage, /w-full max-w-md/)
  assert.match(posPage, /lg:grid-cols-\[minmax\(0,1\.35fr\)_minmax\(340px,\.65fr\)\]/)
  assert.match(posPage, /flex flex-col justify-between gap-3[^\n]*sm:flex-row sm:items-center/)
  assert.match(posPage, /flex flex-col-reverse gap-2[^\n]*sm:flex-row/)
})

test('POS installation supports standalone mode, iOS instructions, and app reopening', () => {
  assert.match(manifest, /display: 'standalone'/)
  assert.match(manifest, /orientation: 'any'/)
  assert.match(installControl, /beforeinstallprompt/)
  assert.match(installControl, /appinstalled/)
  assert.match(installControl, /Add to Home Screen/)
  assert.match(installControl, /display-mode: standalone/)
})


test('actual receipts use the saved device paper width and outlet identity', () => {
  assert.match(posPage, /loadPosDeviceSettings/)
  assert.match(posPage, /paperWidth === "58" \? 58 : 80/)
  assert.match(posPage, /@page \{ size: \${paperWidth}mm/)
  assert.match(posPage, /receipt_address/)
  assert.match(posPage, /fulfillment_outlet_name/)
  assert.match(settingsPage, /Windows selects the actual printer/)
  assert.match(settingsPage, /Windows printer driver performs the actual drawer trigger/)
})


test('POS settings identify physical outlet versus registered address fallback', () => {
  const authMe = fs.readFileSync('src/app/api/auth/me/route.ts', 'utf8')
  const bootstrap = fs.readFileSync('src/app/api/city/pos/bootstrap/route.ts', 'utf8')
  assert.match(authMe, /address_source: hasPhysicalOutlet \? 'physical_outlet' : 'registered_address'/)
  assert.match(bootstrap, /receipt_address_source: hasPhysicalOutlet \? "physical_outlet" : "registered_address"/)
  assert.match(settingsPage, /Receipt branch details/)
  assert.match(settingsPage, /Using registered address/)
  assert.match(settingsPage, /Only the city distributor or branch owner can update/)
  assert.match(settingsPage, /dashboard\/city\/profile/)
})


test('cashier bootstrap does not expose confidential acquisition costs', () => {
  const bootstrap = fs.readFileSync('src/app/api/city/pos/bootstrap/route.ts', 'utf8')

  assert.doesNotMatch(bootstrap, /acquisition_cost/)
  assert.doesNotMatch(bootstrap, /city_price:\s*true/)
  assert.doesNotMatch(bootstrap, /branch_price:\s*true/)
  assert.doesNotMatch(bootstrap, /cost_price:\s*true/)
})

test('disabled POS terminals cannot silently reactivate during bootstrap', () => {
  const bootstrap = fs.readFileSync('src/app/api/city/pos/bootstrap/route.ts', 'utf8')
  const inactiveGuard = bootstrap.indexOf('existing && !existing.is_active')
  const existingUpdate = bootstrap.indexOf('prisma.posTerminal.update')

  assert.match(bootstrap, /existing && !existing\.is_active/)
  assert.match(bootstrap, /POS terminal has been disabled/)
  assert.match(bootstrap, /status: 403/)
  assert.ok(inactiveGuard >= 0 && inactiveGuard < existingUpdate)
  assert.doesNotMatch(bootstrap, /data:\s*\{\s*platform,\s*is_active:\s*true\s*\}/)
})

test('active POS terminals retain bootstrap while unknown devices require enrollment', () => {
  const bootstrap = fs.readFileSync('src/app/api/city/pos/bootstrap/route.ts', 'utf8')

  assert.match(bootstrap, /prisma\.posTerminal\.update/)
  assert.match(bootstrap, /data:\s*\{\s*platform\s*\}/)
  assert.match(bootstrap, /POS_ENROLLMENT_REQUIRED/)
  assert.doesNotMatch(bootstrap, /prisma\.posTerminal\.create/)
})

test('manager-controlled enrollment is expiring, single-use, scoped, and rate limited', () => {
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
  const managerRoute = fs.readFileSync('src/app/api/city/pos/terminals/route.ts', 'utf8')
  const enrollRoute = fs.readFileSync('src/app/api/city/pos/enroll/route.ts', 'utf8')
  const enrollmentHelper = fs.readFileSync('src/app/lib/posEnrollment.ts', 'utf8')
  const setupPage = fs.readFileSync('src/app/dashboard/city/pos/setup/page.tsx', 'utf8')

  assert.match(schema, /model PosTerminalEnrollment/)
  assert.match(schema, /code_hash\s+String\s+@unique/)
  assert.match(managerRoute, /if \(!user \|\| user\.role !== 'city' \|\| user\.is_staff\) return null/)
  assert.match(managerRoute, /isSensitiveResellerPinAccepted\(pinVerification\)/)
  assert.match(enrollmentHelper, /POS_ENROLLMENT_TTL_MS = 15 \* 60 \* 1000/)
  assert.match(enrollmentHelper, /createHash\('sha256'\)/)
  assert.match(enrollmentHelper, /request_count[\s\S]*<= 10/)
  assert.match(enrollRoute, /enrollment\.owner_id !== user\.id/)
  assert.match(enrollRoute, /used_at: null, revoked_at: null, expires_at: \{ gt: now \}/)
  assert.match(enrollRoute, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/)
  assert.match(enrollRoute, /pos_terminal_enrolled/)
  assert.match(setupPage, /one-time enrollment code/i)
})


test('cashier inventory response excludes management financials and uses current shift totals', () => {
  const inventoryApi = fs.readFileSync('src/app/api/city/inventory/route.ts', 'utf8')
  const inventoryPage = fs.readFileSync('src/app/dashboard/city/inventory/page.tsx', 'utf8')
  assert.match(inventoryApi, /canViewFinancials = user\.is_staff !== true \|\| user\.permissions\?\.includes\('reports'\)/)
  assert.match(inventoryApi, /productSales: canViewFinancials \? productSales : \[\]/)
  assert.match(inventoryApi, /city_price: canViewFinancials \? inventoryCost\(item\.product\) : null/)
  assert.match(inventoryApi, /cashier_shift_summary: canViewFinancials \? null : cashierShiftSummary/)
  assert.doesNotMatch(inventoryApi, /expected_drawer_cash/)
  assert.match(inventoryPage, /Current Shift Summary/)
  assert.doesNotMatch(inventoryPage, /Expected Drawer Cash/)
  assert.match(inventoryPage, /canViewFinancials === true/)
  assert.match(inventoryPage, /Today’s Sales Snapshot/)
  assert.match(inventoryPage, /Use Reports for custom dates and full details/)
  assert.doesNotMatch(inventoryPage, /setFinancialPeriod/)
})
