import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildRegistrationPinSnapshot,
  parseRegistrationPinSnapshot,
  readIssuedRegistrationPinSnapshot,
  registrationPinSnapshotsMatch,
} from '../src/app/lib/registrationPinSnapshot'

const starterInput = {
  packageId: 'starter',
  packageName: 'Starter',
  configuredPinPrice: 660,
  directAllocation: 300,
  points: 600,
  acquisitionTier: 'city' as const,
  products: [{
    product_id: 'poseidon',
    quantity: 10,
    product: {
      price: 249,
      reseller_price: 183,
      city_price: 163,
      branch_price: 150,
      cost_price: 110,
    },
  }],
}

test('registration PIN snapshot seals the exact Starter economics and product release', () => {
  const snapshot = buildRegistrationPinSnapshot(starterInput)

  assert.deepEqual({
    customerPayment: snapshot.customerPayment,
    resellerValue: snapshot.resellerValue,
    acquisitionCost: snapshot.acquisitionCost,
    pinAllocation: snapshot.pinAllocation,
    directAllocation: snapshot.directAllocation,
    binaryAllocation: snapshot.binaryAllocation,
    points: snapshot.points,
    lines: snapshot.productLineCount,
    units: snapshot.units,
  }, {
    customerPayment: 2490,
    resellerValue: 1830,
    acquisitionCost: 1630,
    pinAllocation: 660,
    directAllocation: 300,
    binaryAllocation: 300,
    points: 600,
    lines: 1,
    units: 10,
  })
})

test('the immutable registration ledger distinguishes City and Branch channels', () => {
  const route = readFileSync('src/app/api/city/resellers/route.ts', 'utf8')
  assert.match(route, /registration_channel:\s*registrationSnapshot\.acquisitionTier/)
})

test('registration snapshot rejects mismatched PIN price, underfunding, and outlet loss', () => {
  assert.throws(
    () => buildRegistrationPinSnapshot({ ...starterInput, configuredPinPrice: 659 }),
    /must equal the package SRP less reseller value/i,
  )
  assert.throws(
    () => buildRegistrationPinSnapshot({ ...starterInput, directAllocation: 361 }),
    /cannot fully fund/i,
  )
  assert.throws(
    () => buildRegistrationPinSnapshot({
      ...starterInput,
      products: [{
        ...starterInput.products[0],
        product: { ...starterInput.products[0].product, city_price: 190 },
      }],
    }),
    /must cover the outlet acquisition cost/i,
  )
})

test('stored request snapshots reject coercion, duplicate products, and tampering', () => {
  const snapshot = buildRegistrationPinSnapshot(starterInput)
  assert.deepEqual(parseRegistrationPinSnapshot(snapshot), snapshot)

  assert.throws(
    () => parseRegistrationPinSnapshot({ ...snapshot, points: '600' }),
    /invalid financial values/i,
  )
  assert.throws(
    () => parseRegistrationPinSnapshot({
      ...snapshot,
      productLineCount: 2,
      units: 20,
      customerPayment: 4980,
      resellerValue: 3660,
      acquisitionCost: 3260,
      pinAllocation: 1320,
      directAllocation: 600,
      binaryAllocation: 600,
      products: [snapshot.products[0], { ...snapshot.products[0] }],
    }),
    /inconsistent or underfunded/i,
  )
  assert.throws(
    () => parseRegistrationPinSnapshot({ ...snapshot, directAllocation: -1 }),
    /inconsistent or underfunded/i,
  )
})

test('issued PIN reader accepts only complete immutable rows and exact product totals', () => {
  const expected = buildRegistrationPinSnapshot(starterInput)
  const issued = {
    package_id: expected.packageId,
    pin_allocation_snapshot: expected.pinAllocation,
    registration_package_name_snapshot: expected.packageName,
    registration_customer_payment_snapshot: expected.customerPayment,
    registration_reseller_value_snapshot: expected.resellerValue,
    registration_acquisition_cost_snapshot: expected.acquisitionCost,
    registration_acquisition_tier_snapshot: expected.acquisitionTier,
    registration_direct_allocation_snapshot: expected.directAllocation,
    registration_binary_allocation_snapshot: expected.binaryAllocation,
    registration_points_snapshot: expected.points,
    registration_product_line_count_snapshot: expected.productLineCount,
    registration_units_snapshot: expected.units,
    registration_product_snapshots: expected.products,
  }

  const readback = readIssuedRegistrationPinSnapshot(issued)
  assert.equal(registrationPinSnapshotsMatch(expected, readback), true)
  assert.throws(
    () => readIssuedRegistrationPinSnapshot({
      ...issued,
      registration_product_snapshots: [],
    }),
    /legacy registration PIN has no complete financial snapshot/i,
  )
  assert.throws(
    () => readIssuedRegistrationPinSnapshot({
      ...issued,
      registration_acquisition_cost_snapshot: 1700,
    }),
    /inconsistent or underfunded/i,
  )
})

test('database and routes fail closed for uncertified legacy PINs and unsafe quantities', () => {
  const migration = readFileSync(
    'prisma/migrations/20260902141000_snapshot_registration_pin_economics/migration.sql',
    'utf8',
  )
  const adminPins = readFileSync('src/app/api/admin/pins/route.ts', 'utf8')
  const requests = readFileSync('src/app/api/pin-requests/route.ts', 'utf8')

  assert.match(migration, /Never infer a historical contract from today's mutable package settings/)
  assert.match(migration, /WITH candidate AS \([\s\S]*?WHERE FALSE/)
  assert.match(migration, /TG_OP = 'INSERT'[\s\S]*must be issued unused with a complete immutable snapshot/)
  assert.match(migration, /pin_has_exact_paid_source/)
  assert.match(migration, /registration_snapshot_is_valid/)
  assert.match(migration, /seen_product_ids \? product_id_value/)
  assert.match(migration, /registration_snapshot_matches_pin/)
  assert.match(migration, /allocation_snapshot_source" <> 'registration'/)
  assert.match(migration, /NEW\."paid_at" IS NULL/)
  assert.match(adminPins, /Number\.isSafeInteger\(quantity\)/)
  assert.match(requests, /Number\.isSafeInteger\(quantity\)[\s\S]*quantity > 50/)
})

test('registration and upgrade consume only unreserved stock with one conditional transaction write', () => {
  const registrationRoute = readFileSync('src/app/api/city/resellers/route.ts', 'utf8')
  const upgradeRoute = readFileSync('src/app/api/city/resellers/upgrade/route.ts', 'utf8')
  const stockHelper = readFileSync('src/app/lib/inventoryReservation.ts', 'utf8')

  assert.match(registrationRoute, /consumeAvailableStock\(/)
  assert.match(upgradeRoute, /consumeAvailableStock\(/)
  assert.doesNotMatch(registrationRoute, /quantity:\s*\{ decrement: item\.quantity \}/)
  assert.doesNotMatch(upgradeRoute, /quantity:\s*\{ decrement: item\.quantity \}/)
  assert.match(stockHelper, /\("quantity" - "reserved_quantity"\) >= \$\{item\.quantity\}/)
})
