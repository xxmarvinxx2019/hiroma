import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  assertRegistrationPinFunding,
  assertUpgradePinIssuanceEconomics,
  assertUpgradePinFunding,
  calculateUpgradeProductEconomics,
  getUpgradeAcquisitionPrice,
  normalizeUpgradePaths,
  requiredRegistrationFunding,
  requiredUpgradeFunding,
} from '../src/app/lib/packageUpgradeConfiguration'

test('registration PIN price covers direct and package-binary allocations', () => {
  assert.equal(requiredRegistrationFunding(500, 200), 600)
  assert.doesNotThrow(() => assertRegistrationPinFunding(600, 500, 200))
  assert.throws(
    () => assertRegistrationPinFunding(599.99, 500, 200),
    /minimum ₱600\.00/,
  )
})

test('upgrade PIN price covers only positive incremental retained allocations', () => {
  assert.equal(requiredUpgradeFunding(200, 500, 100, 200), 350)
  assert.doesNotThrow(() => assertUpgradePinFunding(350, 200, 500, 100, 200, 'Starter'))
  assert.throws(
    () => assertUpgradePinFunding(349.99, 200, 500, 100, 200, 'Starter'),
    /at least ₱350\.00/,
  )

  // A source package may already have a higher direct allocation. Existing
  // lower-source eligibility is based on package value and Binary points; only
  // the positive direct difference is retained by the upgrade.
  assert.equal(requiredUpgradeFunding(600, 500, 100, 150), 25)
  assert.doesNotThrow(() => assertUpgradePinFunding(25, 600, 500, 100, 150, 'Starter'))
})

test('normalizes a configured package upgrade price and exact product release', () => {
  const paths = normalizeUpgradePaths([{
    from_package_id: 'starter',
    customer_price: 2490,
    pin_price: 660,
    products: [{ product_id: 'poseidon', quantity: 10 }],
  }], 'silver')

  assert.deepEqual(paths, [{
    from_package_id: 'starter',
    customer_price: 2490,
    pin_price: 660,
    products: [{ product_id: 'poseidon', quantity: 10 }],
  }])
})

test('rejects duplicate source packages and invalid product releases', () => {
  assert.throws(() => normalizeUpgradePaths([
    { from_package_id: 'starter', customer_price: 2490, pin_price: 660, products: [{ product_id: 'poseidon', quantity: 10 }] },
    { from_package_id: 'starter', customer_price: 2490, pin_price: 660, products: [{ product_id: 'clio', quantity: 10 }] },
  ], 'silver'), /only have one upgrade option/)
  assert.throws(() => normalizeUpgradePaths([
    { from_package_id: 'starter', customer_price: 2490, pin_price: 660, products: [] },
  ], 'silver'), /at least one product/)
})

test('PIN issuance and redemption use immutable configured product snapshots', () => {
  const pinRoute = readFileSync(new URL('../src/app/api/admin/pins/route.ts', import.meta.url), 'utf8')
  const upgradeRoute = readFileSync(new URL('../src/app/api/city/resellers/upgrade/route.ts', import.meta.url), 'utf8')
  const verifyRoute = readFileSync(new URL('../src/app/api/city/pins/verify-upgrade/route.ts', import.meta.url), 'utf8')
  assert.match(pinRoute, /packageUpgradePath\.findUnique/)
  assert.match(pinRoute, /pinUpgradeProductSnapshot\.createMany/)
  assert.match(upgradeRoute, /pin\.upgrade_product_snapshots/)
  assert.match(verifyRoute, /pin\.upgrade_product_snapshots/)
  assert.doesNotMatch(upgradeRoute, /item\.quantity - \(oldQty/)
  assert.doesNotMatch(verifyRoute, /currentQuantities/)
})

test('upgrade product economics use the immutable recipient price tier', () => {
  const products = [{
    quantity: 10,
    product: {
      price: 249,
      reseller_price: 183,
      city_price: 163,
      branch_price: 110,
      cost_price: 100,
    },
  }]

  assert.deepEqual(calculateUpgradeProductEconomics(products, 'city'), {
    customerPayment: 2490,
    resellerValue: 1830,
    acquisitionCost: 1630,
  })
  assert.deepEqual(calculateUpgradeProductEconomics(products, 'branch'), {
    customerPayment: 2490,
    resellerValue: 1830,
    acquisitionCost: 1100,
  })
  assert.equal(getUpgradeAcquisitionPrice(products[0].product, 'city'), 163)
  assert.equal(getUpgradeAcquisitionPrice(products[0].product, 'branch'), 110)
})

test('Upgrade PIN issuance seals exact product, PIN, and allocation economics', () => {
  const products = [{
    quantity: 10,
    product: {
      price: 249,
      reseller_price: 183,
      city_price: 163,
      branch_price: 110,
      cost_price: 100,
    },
  }]
  const productEconomics = calculateUpgradeProductEconomics(products, 'city')

  assert.deepEqual(assertUpgradePinIssuanceEconomics({
    customerPrice: 2490,
    pinPrice: 660,
    sourceDirectAllocation: 300,
    targetDirectAllocation: 500,
    sourceBinaryPoints: 600,
    targetBinaryPoints: 1000,
    sourceLabel: 'Starter',
    acquisitionTier: 'city',
    products,
    productEconomics,
  }), {
    customerPayment: 2490,
    resellerValue: 1830,
    acquisitionCost: 1630,
    pinAllocation: 660,
    directAllocation: 200,
    binaryAllocation: 200,
    pointsDifference: 400,
    productLineCount: 1,
    units: 10,
  })
})

test('Upgrade PIN issuance rejects mismatched prices, product loss, and underfunding', () => {
  const products = [{
    quantity: 10,
    product: {
      price: 249,
      reseller_price: 183,
      city_price: 163,
      branch_price: 110,
      cost_price: 100,
    },
  }]
  const base = {
    customerPrice: 2490,
    pinPrice: 660,
    sourceDirectAllocation: 300,
    targetDirectAllocation: 500,
    sourceBinaryPoints: 600,
    targetBinaryPoints: 1000,
    sourceLabel: 'Starter',
    acquisitionTier: 'city' as const,
    products,
    productEconomics: calculateUpgradeProductEconomics(products, 'city'),
  }

  assert.throws(
    () => assertUpgradePinIssuanceEconomics({ ...base, customerPrice: 2480 }),
    /exact product SRP total/,
  )
  assert.throws(
    () => assertUpgradePinIssuanceEconomics({ ...base, pinPrice: 650 }),
    /customer price less reseller value/,
  )
  assert.throws(
    () => assertUpgradePinIssuanceEconomics({
      ...base,
      targetDirectAllocation: 800,
    }),
    /at least ₱700\.00/,
  )

  const lossProducts = [{
    ...products[0],
    product: { ...products[0].product, city_price: 190 },
  }]
  assert.throws(
    () => assertUpgradePinIssuanceEconomics({
      ...base,
      products: lossProducts,
      productEconomics: calculateUpgradeProductEconomics(lossProducts, 'city'),
    }),
    /cannot sell below their acquisition cost/,
  )
})

test('Upgrade PIN database seal is complete and legacy snapshots are never inferred', () => {
  const pinRoute = readFileSync(new URL('../src/app/api/admin/pins/route.ts', import.meta.url), 'utf8')
  const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
  const migration = readFileSync(
    new URL('../prisma/migrations/20260902142000_seal_upgrade_pin_economics/migration.sql', import.meta.url),
    'utf8',
  )
  const integrityRoute = readFileSync(
    new URL('../src/app/api/admin/commission-testing/reserve-ledger/route.ts', import.meta.url),
    'utf8',
  )
  const integrityPage = readFileSync(
    new URL('../src/app/dashboard/admin/commission-testing/reserve-ledger/page.tsx', import.meta.url),
    'utf8',
  )

  assert.match(pinRoute, /assertUpgradePinIssuanceEconomics/)
  assert.match(pinRoute, /upgrade_product_line_count_snapshot: upgradeSnapshot\?\.productLineCount \?\? null/)
  assert.match(pinRoute, /upgrade_units_snapshot: upgradeSnapshot\?\.units \?\? null/)
  assert.match(pinRoute, /srp_snapshot: product\.srp_snapshot/)
  assert.match(pinRoute, /reseller_price_snapshot: product\.reseller_price_snapshot/)
  assert.match(schema, /upgrade_product_line_count_snapshot\s+Int\?/)
  assert.match(schema, /upgrade_units_snapshot\s+Int\?/)
  assert.match(schema, /model PinUpgradeProductSnapshot[\s\S]*srp_snapshot[\s\S]*reseller_price_snapshot/)
  assert.match(migration, /upgrade_pin_snapshot_is_exact/)
  assert.match(migration, /pin_upgrade_product_snapshots_append_only/)
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "pin_upgrade_product_snapshots"/)
  assert.match(migration, /NOT "upgrade_pin_snapshot_is_exact"\(issued\."id"\)/)
  assert.match(migration, /Cancel and reissue legacy PINs/)
  assert.match(migration, /allocation_snapshot_source" <> 'upgrade_pin_snapshot'/)
  assert.match(migration, /NEW\."paid_at" IS NULL/)
  assert.doesNotMatch(migration, /UPDATE "pins"[\s\S]*package_upgrade_paths/)
  assert.match(integrityRoute, /unreconciled_upgrade_pins/)
  assert.match(integrityRoute, /NOT upgrade_pin_snapshot_is_exact\(id\)/)
  assert.match(integrityPage, /Legacy Upgrade PINs to cancel\/reissue/)
})

test('issued upgrade points, acquisition tier, and retained income remain separate', () => {
  const pinRoute = readFileSync(new URL('../src/app/api/admin/pins/route.ts', import.meta.url), 'utf8')
  const upgradeRoute = readFileSync(new URL('../src/app/api/city/resellers/upgrade/route.ts', import.meta.url), 'utf8')
  const verifyRoute = readFileSync(new URL('../src/app/api/city/pins/verify-upgrade/route.ts', import.meta.url), 'utf8')
  const reserveRoute = readFileSync(new URL('../src/app/api/admin/commission-testing/reserve-ledger/route.ts', import.meta.url), 'utf8')
  const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')

  assert.match(pinRoute, /distributor_profile: \{ select: \{ dist_level: true, is_active: true \} \}/)
  assert.match(pinRoute, /calculateUpgradeProductEconomics\(configuredPath\.products, acquisitionTier\)/)
  assert.match(pinRoute, /upgrade_acquisition_tier_snapshot: upgradeSnapshot\?\.acquisitionTier \?\? null/)
  assert.match(pinRoute, /unit_acquisition_cost_snapshot: getUpgradeAcquisitionPrice/)
  assert.match(upgradeRoute, /const diffPts = Number\(pin\.upgrade_points_difference_snapshot\)/)
  assert.match(upgradeRoute, /sourcePoints: diffPts/)
  assert.doesNotMatch(upgradeRoute, /const diffPts = newPts - oldPts/)
  assert.match(upgradeRoute, /pin\.upgrade_acquisition_tier_snapshot !== "branch"/)
  assert.match(upgradeRoute, /unit_cost: Number\(item\.unit_acquisition_cost_snapshot\)/)
  assert.match(verifyRoute, /upgrade_acquisition_tier_snapshot !== 'city'/)
  assert.match(schema, /upgrade_acquisition_tier_snapshot\s+String\?/)
  assert.match(reserveRoute, /SUM\(direct_referral_allocation\) FROM registration_financials/)
  assert.doesNotMatch(reserveRoute, /SUM\(direct_referral_allocation\) FROM upgrade_financials/)
  assert.match(reserveRoute, /SUM\(direct_referral_retained\) FROM upgrade_financials/)
  assert.match(reserveRoute, /total_direct_retained/)
  const pinPage = readFileSync(new URL('../src/app/dashboard/admin/pins/page.tsx', import.meta.url), 'utf8')
  assert.match(pinPage, /parent_level=city,branch/)
  assert.match(pinPage, /eligiblePinRecipients/)
})

test('package editor and API only allow lower packages as upgrade sources', () => {
  const page = readFileSync(new URL('../src/app/dashboard/admin/packages/page.tsx', import.meta.url), 'utf8')
  const route = readFileSync(new URL('../src/app/api/admin/packages/[id]/route.ts', import.meta.url), 'utf8')
  assert.match(page, /Number\(pkg\.pairing_bonus_value\) < Number\(form\.pairing_bonus_value/)
  assert.match(page, /Number\(pkg\.price\) < Number\(form\.price/)
  assert.match(page, /eligibleUpgradeSources\.length > 0/)
  assert.match(page, /setUpgradePaths\(\(currentPaths\) =>/)
  assert.match(page, /const nextSource = eligibleUpgradeSources\.find/)
  assert.match(page, /if \(!nextSource\) return currentPaths/)
  assert.match(route, /Number\(source\.pairing_bonus_value\) >= targetPoints/)
  assert.match(route, /lower than the target package in both package value and points/)
})

test('admin package writes enforce registration and incremental upgrade funding', () => {
  const collectionRoute = readFileSync(new URL('../src/app/api/admin/packages/route.ts', import.meta.url), 'utf8')
  const packageRoute = readFileSync(new URL('../src/app/api/admin/packages/[id]/route.ts', import.meta.url), 'utf8')

  assert.equal((collectionRoute.match(/assertRegistrationPinFunding\(/g) || []).length, 1)
  assert.doesNotMatch(collectionRoute, /export async function PUT/)
  assert.doesNotMatch(collectionRoute, /export async function PATCH/)
  assert.match(packageRoute, /assertRegistrationPinFunding\(price, direct_referral_bonus, pairing_bonus_value\)/)
  assert.match(packageRoute, /assertUpgradePinFunding\([\s\S]*path\.pin_price[\s\S]*source\.direct_referral_bonus[\s\S]*source\.pairing_bonus_value/)
  assert.match(packageRoute, /pg_advisory_xact_lock\(hashtext\('package-upgrade-funding-configuration'\)\)/)
  assert.match(packageRoute, /packageUpgradePath\.findMany\([\s\S]*from_package_id: id[\s\S]*assertUpgradePinFunding\([\s\S]*target\.direct_referral_bonus/)
  assert.match(packageRoute, /PackageFundingConfigurationError/)
})

test('database keeps every active upgrade path lower-to-higher and funded', () => {
  const migration = readFileSync(
    new URL('../prisma/migrations/20260902150000_enforce_upgrade_path_ordering/migration.sql', import.meta.url),
    'utf8',
  )
  assert.match(migration, /source\."price" >= target\."price"/)
  assert.match(migration, /source\."pairing_bonus_value" >= target\."pairing_bonus_value"/)
  assert.match(migration, /required_funding/)
  assert.match(migration, /package_upgrade_paths_validate_ordering/)
  assert.match(migration, /packages_revalidate_upgrade_paths/)
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('package-upgrade-funding-configuration'\)\)/)
})
