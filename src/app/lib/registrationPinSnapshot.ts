export type RegistrationAcquisitionTier = 'admin' | 'city' | 'branch'

export type RegistrationSnapshotProductInput = {
  product_id: string
  quantity: number
  product: {
    price: unknown
    reseller_price: unknown
    city_price: unknown
    branch_price: unknown
    cost_price: unknown
  }
}

export type RegistrationPinSnapshot = {
  version: 'registration-pin-v1'
  packageId: string
  packageName: string
  acquisitionTier: RegistrationAcquisitionTier
  customerPayment: number
  resellerValue: number
  acquisitionCost: number
  pinAllocation: number
  directAllocation: number
  binaryAllocation: number
  points: number
  productLineCount: number
  units: number
  products: Array<{
    product_id: string
    quantity: number
    srp_snapshot: number
    reseller_price_snapshot: number
    unit_acquisition_cost_snapshot: number
  }>
}

export class RegistrationPinSnapshotError extends Error {}

const money = (value: number) => Math.round(value * 100) / 100

function positiveMoney(value: unknown, label: string, allowZero = true) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) {
    throw new RegistrationPinSnapshotError(`${label} is invalid.`)
  }
  return money(amount)
}

function acquisitionPrice(
  product: RegistrationSnapshotProductInput['product'],
  tier: RegistrationAcquisitionTier,
) {
  if (tier === 'admin') return positiveMoney(product.cost_price, 'Admin product cost', false)
  if (tier === 'branch') {
    const value = Number(product.branch_price) || Number(product.cost_price)
    return positiveMoney(value, 'Branch product cost', false)
  }
  const value = Number(product.city_price) || Number(product.cost_price)
  return positiveMoney(value, 'City product cost', false)
}

export function buildRegistrationPinSnapshot(input: {
  packageId: string
  packageName: string
  configuredPinPrice: unknown
  directAllocation: unknown
  points: unknown
  acquisitionTier: RegistrationAcquisitionTier
  products: RegistrationSnapshotProductInput[]
}): RegistrationPinSnapshot {
  if (!input.packageId || !input.packageName.trim() || input.products.length === 0) {
    throw new RegistrationPinSnapshotError('Registration package must include products.')
  }

  const seen = new Set<string>()
  const products = input.products.map((item) => {
    if (!item.product_id || seen.has(item.product_id) || !Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new RegistrationPinSnapshotError('Registration package contains an invalid product allocation.')
    }
    seen.add(item.product_id)
    const srp = positiveMoney(item.product.price, 'Product SRP', false)
    const resellerPrice = positiveMoney(Number(item.product.reseller_price) || srp, 'Product reseller price', false)
    return {
      product_id: item.product_id,
      quantity: item.quantity,
      srp_snapshot: srp,
      reseller_price_snapshot: resellerPrice,
      unit_acquisition_cost_snapshot: acquisitionPrice(item.product, input.acquisitionTier),
    }
  })

  const customerPayment = money(products.reduce((sum, item) => sum + item.srp_snapshot * item.quantity, 0))
  const resellerValue = money(products.reduce((sum, item) => sum + item.reseller_price_snapshot * item.quantity, 0))
  const acquisitionCost = money(products.reduce((sum, item) => sum + item.unit_acquisition_cost_snapshot * item.quantity, 0))
  const units = products.reduce((sum, item) => sum + item.quantity, 0)
  const pinAllocation = money(customerPayment - resellerValue)
  const configuredPinPrice = positiveMoney(input.configuredPinPrice, 'Configured PIN price')
  const directAllocation = positiveMoney(input.directAllocation, 'Direct referral allocation')
  const points = Number(input.points)
  if (!Number.isInteger(points) || points <= 0) {
    throw new RegistrationPinSnapshotError('Package Binary points must be a positive whole number.')
  }
  const binaryAllocation = money(points * 0.5)

  if (Math.abs(configuredPinPrice - pinAllocation) >= 0.01) {
    throw new RegistrationPinSnapshotError(
      `Configured PIN price (₱${configuredPinPrice.toFixed(2)}) must equal the package SRP less reseller value (₱${pinAllocation.toFixed(2)}).`,
    )
  }
  if (directAllocation + binaryAllocation > pinAllocation) {
    throw new RegistrationPinSnapshotError(
      'PIN price cannot fully fund the Direct Referral and Package Binary allocations.',
    )
  }
  if (resellerValue < acquisitionCost) {
    throw new RegistrationPinSnapshotError(
      'Package reseller value must cover the outlet acquisition cost.',
    )
  }

  return {
    version: 'registration-pin-v1',
    packageId: input.packageId,
    packageName: input.packageName.trim(),
    acquisitionTier: input.acquisitionTier,
    customerPayment,
    resellerValue,
    acquisitionCost,
    pinAllocation,
    directAllocation,
    binaryAllocation,
    points,
    productLineCount: products.length,
    units,
    products,
  }
}

export function parseRegistrationPinSnapshot(value: unknown): RegistrationPinSnapshot {
  if (!value || typeof value !== 'object') throw new RegistrationPinSnapshotError('Registration PIN snapshot is missing.')
  const raw = value as Partial<RegistrationPinSnapshot>
  if (raw.version !== 'registration-pin-v1'
    || typeof raw.packageId !== 'string' || !raw.packageId.trim()
    || typeof raw.packageName !== 'string' || !raw.packageName.trim()
    || !['admin', 'city', 'branch'].includes(String(raw.acquisitionTier))
    || !Array.isArray(raw.products) || raw.products.length === 0) {
    throw new RegistrationPinSnapshotError('Registration PIN snapshot is incomplete.')
  }
  const numeric = [raw.customerPayment, raw.resellerValue, raw.acquisitionCost, raw.pinAllocation, raw.directAllocation, raw.binaryAllocation, raw.points, raw.productLineCount, raw.units]
  if (numeric.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new RegistrationPinSnapshotError('Registration PIN snapshot contains invalid financial values.')
  }
  const snapshot = raw as RegistrationPinSnapshot
  const productIds = new Set<string>()
  const invalidProduct = snapshot.products.some((item) => {
    if (!item || typeof item !== 'object'
      || typeof item.product_id !== 'string' || !item.product_id.trim()
      || productIds.has(item.product_id)
      || !Number.isSafeInteger(item.quantity) || item.quantity <= 0
      || typeof item.srp_snapshot !== 'number' || !Number.isFinite(item.srp_snapshot) || item.srp_snapshot <= 0
      || typeof item.reseller_price_snapshot !== 'number' || !Number.isFinite(item.reseller_price_snapshot) || item.reseller_price_snapshot <= 0
      || typeof item.unit_acquisition_cost_snapshot !== 'number'
      || !Number.isFinite(item.unit_acquisition_cost_snapshot) || item.unit_acquisition_cost_snapshot <= 0) {
      return true
    }
    productIds.add(item.product_id)
    return false
  })
  const productCustomerPayment = snapshot.products.reduce((sum, item) => sum + item.srp_snapshot * item.quantity, 0)
  const productResellerValue = snapshot.products.reduce((sum, item) => sum + item.reseller_price_snapshot * item.quantity, 0)
  const productAcquisitionCost = snapshot.products.reduce((sum, item) => sum + item.unit_acquisition_cost_snapshot * item.quantity, 0)
  const units = snapshot.products.reduce((sum, item) => sum + item.quantity, 0)
  if (!Number.isSafeInteger(snapshot.points) || snapshot.points <= 0
    || !Number.isSafeInteger(snapshot.productLineCount) || snapshot.productLineCount !== snapshot.products.length
    || !Number.isInteger(snapshot.units) || snapshot.units !== units
    || invalidProduct
    || snapshot.customerPayment < 0 || snapshot.resellerValue < 0 || snapshot.acquisitionCost < 0
    || snapshot.pinAllocation < 0 || snapshot.directAllocation < 0 || snapshot.binaryAllocation < 0
    || !equalMoney(snapshot.customerPayment, productCustomerPayment)
    || !equalMoney(snapshot.resellerValue, productResellerValue)
    || !equalMoney(snapshot.acquisitionCost, productAcquisitionCost)
    || !equalMoney(snapshot.customerPayment, snapshot.resellerValue + snapshot.pinAllocation)
    || !equalMoney(snapshot.binaryAllocation, snapshot.points * 0.5)
    || snapshot.directAllocation + snapshot.binaryAllocation > snapshot.pinAllocation + 0.001
    || snapshot.resellerValue < snapshot.acquisitionCost) {
    throw new RegistrationPinSnapshotError('Registration PIN request snapshot is inconsistent or underfunded.')
  }
  return snapshot
}

type IssuedRegistrationPinSnapshot = {
  package_id: string
  pin_allocation_snapshot: unknown
  registration_package_name_snapshot: string | null
  registration_customer_payment_snapshot: unknown
  registration_reseller_value_snapshot: unknown
  registration_acquisition_cost_snapshot: unknown
  registration_acquisition_tier_snapshot: string | null
  registration_direct_allocation_snapshot: unknown
  registration_binary_allocation_snapshot: unknown
  registration_points_snapshot: number | null
  registration_product_line_count_snapshot: number | null
  registration_units_snapshot: number | null
  registration_product_snapshots: Array<{
    product_id: string
    quantity: number
    srp_snapshot: unknown
    reseller_price_snapshot: unknown
    unit_acquisition_cost_snapshot: unknown
  }>
}

function equalMoney(left: number, right: number) {
  return Math.abs(money(left) - money(right)) < 0.01
}

/**
 * Reconstructs and revalidates the immutable economics attached to an issued
 * registration PIN. Registration must never fall back to the package's current
 * prices or products because those may have changed after the PIN was sold.
 */
export function readIssuedRegistrationPinSnapshot(
  pin: IssuedRegistrationPinSnapshot,
): RegistrationPinSnapshot {
  const packageName = pin.registration_package_name_snapshot?.trim()
  const acquisitionTier = pin.registration_acquisition_tier_snapshot
  const points = Number(pin.registration_points_snapshot)
  const expectedProductLines = Number(pin.registration_product_line_count_snapshot)
  const expectedUnits = Number(pin.registration_units_snapshot)
  if (!packageName
    || !['admin', 'city', 'branch'].includes(String(acquisitionTier))
    || !Number.isInteger(points) || points <= 0
    || !Number.isInteger(expectedProductLines) || expectedProductLines <= 0
    || !Number.isInteger(expectedUnits) || expectedUnits <= 0
    || pin.registration_product_snapshots.length === 0) {
    throw new RegistrationPinSnapshotError(
      'This legacy registration PIN has no complete financial snapshot. Cancel and reissue it before registration.',
    )
  }

  const products = pin.registration_product_snapshots.map((item) => {
    if (!item.product_id || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new RegistrationPinSnapshotError('Registration PIN contains an invalid product snapshot.')
    }
    return {
      product_id: item.product_id,
      quantity: item.quantity,
      srp_snapshot: positiveMoney(item.srp_snapshot, 'Product SRP snapshot'),
      reseller_price_snapshot: positiveMoney(item.reseller_price_snapshot, 'Product reseller-price snapshot'),
      unit_acquisition_cost_snapshot: positiveMoney(item.unit_acquisition_cost_snapshot, 'Product acquisition-cost snapshot'),
    }
  })

  const customerPayment = positiveMoney(pin.registration_customer_payment_snapshot, 'Customer payment snapshot')
  const resellerValue = positiveMoney(pin.registration_reseller_value_snapshot, 'Reseller value snapshot')
  const acquisitionCost = positiveMoney(pin.registration_acquisition_cost_snapshot, 'Acquisition-cost snapshot')
  const pinAllocation = positiveMoney(pin.pin_allocation_snapshot, 'PIN allocation snapshot')
  const directAllocation = positiveMoney(pin.registration_direct_allocation_snapshot, 'Direct-referral allocation snapshot')
  const binaryAllocation = positiveMoney(pin.registration_binary_allocation_snapshot, 'Binary allocation snapshot')
  const productCustomerPayment = products.reduce((sum, item) => sum + item.srp_snapshot * item.quantity, 0)
  const productResellerValue = products.reduce((sum, item) => sum + item.reseller_price_snapshot * item.quantity, 0)
  const productAcquisitionCost = products.reduce((sum, item) => sum + item.unit_acquisition_cost_snapshot * item.quantity, 0)
  const productUnits = products.reduce((sum, item) => sum + item.quantity, 0)

  if (products.length !== expectedProductLines || productUnits !== expectedUnits
    || products.some((item) => item.srp_snapshot <= 0 || item.reseller_price_snapshot <= 0 || item.unit_acquisition_cost_snapshot <= 0)
    || !equalMoney(customerPayment, productCustomerPayment)
    || !equalMoney(resellerValue, productResellerValue)
    || !equalMoney(acquisitionCost, productAcquisitionCost)
    || !equalMoney(customerPayment, resellerValue + pinAllocation)
    || !equalMoney(binaryAllocation, points * 0.5)
    || directAllocation + binaryAllocation > pinAllocation + 0.001
    || resellerValue < acquisitionCost) {
    throw new RegistrationPinSnapshotError('Registration PIN financial snapshot is inconsistent or underfunded.')
  }

  return {
    version: 'registration-pin-v1',
    packageId: pin.package_id,
    packageName,
    acquisitionTier: acquisitionTier as RegistrationAcquisitionTier,
    customerPayment,
    resellerValue,
    acquisitionCost,
    pinAllocation,
    directAllocation,
    binaryAllocation,
    points,
    productLineCount: expectedProductLines,
    units: expectedUnits,
    products,
  }
}

export function registrationPinSnapshotsMatch(
  left: RegistrationPinSnapshot,
  right: RegistrationPinSnapshot,
) {
  const productKey = (snapshot: RegistrationPinSnapshot) => snapshot.products
    .map((item) => [
      item.product_id,
      item.quantity,
      money(item.srp_snapshot),
      money(item.reseller_price_snapshot),
      money(item.unit_acquisition_cost_snapshot),
    ].join(':'))
    .sort()
    .join('|')
  return left.packageId === right.packageId
    && left.packageName === right.packageName
    && left.acquisitionTier === right.acquisitionTier
    && equalMoney(left.customerPayment, right.customerPayment)
    && equalMoney(left.resellerValue, right.resellerValue)
    && equalMoney(left.acquisitionCost, right.acquisitionCost)
    && equalMoney(left.pinAllocation, right.pinAllocation)
    && equalMoney(left.directAllocation, right.directAllocation)
    && equalMoney(left.binaryAllocation, right.binaryAllocation)
    && left.points === right.points
    && left.productLineCount === right.productLineCount
    && left.units === right.units
    && productKey(left) === productKey(right)
}
