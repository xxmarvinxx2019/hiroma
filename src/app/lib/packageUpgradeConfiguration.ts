export interface UpgradeProductInput {
  product_id: string
  quantity: number
}

export interface UpgradePathInput {
  from_package_id: string
  customer_price: number
  pin_price: number
  products: UpgradeProductInput[]
}

export type UpgradeAcquisitionTier = 'city' | 'branch'

export interface UpgradeEconomicProduct {
  quantity: number
  product: {
    price: unknown
    reseller_price: unknown
    city_price: unknown
    branch_price: unknown
    cost_price: unknown
  }
}

export interface UpgradeProductEconomics {
  customerPayment: number
  resellerValue: number
  acquisitionCost: number
}

export interface UpgradePinIssuanceEconomics extends UpgradeProductEconomics {
  pinAllocation: number
  directAllocation: number
  binaryAllocation: number
  pointsDifference: number
  productLineCount: number
  units: number
}

const PACKAGE_BINARY_PESO_PER_POINT = 0.5

export class PackageFundingConfigurationError extends Error {}

function toCentavos(value: unknown, field: string) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) {
    throw new PackageFundingConfigurationError(`${field} must be a valid non-negative amount.`)
  }
  return Math.round(amount * 100)
}

export function requiredRegistrationFunding(
  directAllocation: unknown,
  binaryPoints: unknown,
) {
  const directCentavos = toCentavos(directAllocation, 'Direct referral allocation')
  const binaryCentavos = toCentavos(
    Number(binaryPoints) * PACKAGE_BINARY_PESO_PER_POINT,
    'Package-binary allocation',
  )
  return (directCentavos + binaryCentavos) / 100
}

export function assertRegistrationPinFunding(
  pinPrice: unknown,
  directAllocation: unknown,
  binaryPoints: unknown,
) {
  const pinCentavos = toCentavos(pinPrice, 'Registration PIN price')
  const required = requiredRegistrationFunding(directAllocation, binaryPoints)
  if (pinCentavos < Math.round(required * 100)) {
    throw new PackageFundingConfigurationError(
      `Registration PIN price must cover direct referral and package-binary allocations (minimum ₱${required.toFixed(2)}).`,
    )
  }
}

export function requiredUpgradeFunding(
  sourceDirectAllocation: unknown,
  targetDirectAllocation: unknown,
  sourceBinaryPoints: unknown,
  targetBinaryPoints: unknown,
) {
  const incrementalDirect = Math.max(
    0,
    toCentavos(targetDirectAllocation, 'Target direct referral allocation') -
      toCentavos(sourceDirectAllocation, 'Source direct referral allocation'),
  )
  const sourceBinary = toCentavos(
    Number(sourceBinaryPoints) * PACKAGE_BINARY_PESO_PER_POINT,
    'Source package-binary allocation',
  )
  const targetBinary = toCentavos(
    Number(targetBinaryPoints) * PACKAGE_BINARY_PESO_PER_POINT,
    'Target package-binary allocation',
  )
  return (incrementalDirect + Math.max(0, targetBinary - sourceBinary)) / 100
}

export function assertUpgradePinFunding(
  pinPrice: unknown,
  sourceDirectAllocation: unknown,
  targetDirectAllocation: unknown,
  sourceBinaryPoints: unknown,
  targetBinaryPoints: unknown,
  sourceLabel: string,
) {
  const pinCentavos = toCentavos(pinPrice, 'Upgrade PIN price')
  const required = requiredUpgradeFunding(
    sourceDirectAllocation,
    targetDirectAllocation,
    sourceBinaryPoints,
    targetBinaryPoints,
  )
  if (pinCentavos < Math.round(required * 100)) {
    throw new PackageFundingConfigurationError(
      `Upgrade option from ${sourceLabel} needs a PIN price of at least ₱${required.toFixed(2)} to cover incremental retained-direct and package-binary allocations.`,
    )
  }
}

export function getUpgradeAcquisitionPrice(
  product: UpgradeEconomicProduct['product'],
  acquisitionTier: UpgradeAcquisitionTier,
) {
  return acquisitionTier === 'branch'
    ? Number(product.branch_price) || Number(product.cost_price || 0)
    : Number(product.city_price) || Number(product.cost_price || 0)
}

export function calculateUpgradeProductEconomics(
  products: UpgradeEconomicProduct[],
  acquisitionTier: UpgradeAcquisitionTier,
): UpgradeProductEconomics {
  return products.reduce((total, item) => {
    const srp = Number(item.product.price || 0)
    const reseller = Number(item.product.reseller_price) || srp
    const acquisition = getUpgradeAcquisitionPrice(item.product, acquisitionTier)
    total.customerPayment += srp * item.quantity
    total.resellerValue += reseller * item.quantity
    total.acquisitionCost += acquisition * item.quantity
    return total
  }, { customerPayment: 0, resellerValue: 0, acquisitionCost: 0 })
}

function toPositiveCentavos(value: unknown, field: string) {
  const centavos = toCentavos(value, field)
  if (centavos <= 0) {
    throw new PackageFundingConfigurationError(field + ' must be greater than zero.')
  }
  return centavos
}

/**
 * Seal the complete economic contract before an Upgrade PIN is sold. Upgrade
 * paths and product price lists can change later, but an issued PIN must remain
 * provable from its own immutable totals and product rows.
 */
export function assertUpgradePinIssuanceEconomics(input: {
  customerPrice: unknown
  pinPrice: unknown
  sourceDirectAllocation: unknown
  targetDirectAllocation: unknown
  sourceBinaryPoints: unknown
  targetBinaryPoints: unknown
  sourceLabel: string
  acquisitionTier: UpgradeAcquisitionTier
  products: UpgradeEconomicProduct[]
  productEconomics: UpgradeProductEconomics
}): UpgradePinIssuanceEconomics {
  if (!Array.isArray(input.products) || input.products.length === 0) {
    throw new PackageFundingConfigurationError(
      'Upgrade option from ' + input.sourceLabel + ' must release at least one product.',
    )
  }

  let customerCentavos = 0
  let resellerCentavos = 0
  let acquisitionCentavos = 0
  let units = 0
  for (const [index, item] of input.products.entries()) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new PackageFundingConfigurationError(
        'Upgrade product ' + (index + 1) + ' must have a positive whole-number quantity.',
      )
    }
    const srpCentavos = toPositiveCentavos(
      item.product.price,
      'Upgrade product ' + (index + 1) + ' SRP',
    )
    const resellerPrice = Number(item.product.reseller_price) || Number(item.product.price)
    const resellerPriceCentavos = toPositiveCentavos(
      resellerPrice,
      'Upgrade product ' + (index + 1) + ' reseller price',
    )
    const acquisitionPriceCentavos = toPositiveCentavos(
      getUpgradeAcquisitionPrice(item.product, input.acquisitionTier),
      'Upgrade product ' + (index + 1) + ' acquisition price',
    )
    customerCentavos += srpCentavos * item.quantity
    resellerCentavos += resellerPriceCentavos * item.quantity
    acquisitionCentavos += acquisitionPriceCentavos * item.quantity
    units += item.quantity
  }

  const calculatedCustomerCentavos = toCentavos(
    input.productEconomics.customerPayment,
    'Calculated upgrade customer payment',
  )
  const calculatedResellerCentavos = toCentavos(
    input.productEconomics.resellerValue,
    'Calculated upgrade reseller value',
  )
  const calculatedAcquisitionCentavos = toCentavos(
    input.productEconomics.acquisitionCost,
    'Calculated upgrade acquisition cost',
  )
  if (
    calculatedCustomerCentavos !== customerCentavos ||
    calculatedResellerCentavos !== resellerCentavos ||
    calculatedAcquisitionCentavos !== acquisitionCentavos
  ) {
    throw new PackageFundingConfigurationError(
      'Upgrade option from ' + input.sourceLabel + ' has inconsistent product economics.',
    )
  }

  const configuredCustomerCentavos = toPositiveCentavos(
    input.customerPrice,
    'Customer upgrade price',
  )
  const configuredPinCentavos = toPositiveCentavos(input.pinPrice, 'Upgrade PIN price')
  if (configuredCustomerCentavos !== customerCentavos) {
    throw new PackageFundingConfigurationError(
      'Upgrade price from ' + input.sourceLabel +
        ' must equal the exact product SRP total (₱' +
        (customerCentavos / 100).toFixed(2) + ').',
    )
  }
  if (configuredPinCentavos !== customerCentavos - resellerCentavos) {
    throw new PackageFundingConfigurationError(
      'Upgrade PIN price from ' + input.sourceLabel +
        ' must equal customer price less reseller value (₱' +
        ((customerCentavos - resellerCentavos) / 100).toFixed(2) + ').',
    )
  }
  if (resellerCentavos < acquisitionCentavos) {
    throw new PackageFundingConfigurationError(
      'Upgrade products from ' + input.sourceLabel +
        ' cannot sell below their acquisition cost.',
    )
  }

  const sourcePoints = Number(input.sourceBinaryPoints)
  const targetPoints = Number(input.targetBinaryPoints)
  if (
    !Number.isSafeInteger(sourcePoints) ||
    !Number.isSafeInteger(targetPoints) ||
    sourcePoints < 0 ||
    targetPoints <= sourcePoints
  ) {
    throw new PackageFundingConfigurationError(
      'Upgrade option from ' + input.sourceLabel +
        ' requires a positive whole-number points difference.',
    )
  }
  const pointsDifference = targetPoints - sourcePoints
  const binaryCentavos = pointsDifference * 50
  const directCentavos = Math.max(
    0,
    toCentavos(input.targetDirectAllocation, 'Target direct referral allocation') -
      toCentavos(input.sourceDirectAllocation, 'Source direct referral allocation'),
  )

  assertUpgradePinFunding(
    input.pinPrice,
    input.sourceDirectAllocation,
    input.targetDirectAllocation,
    input.sourceBinaryPoints,
    input.targetBinaryPoints,
    input.sourceLabel,
  )
  if (directCentavos + binaryCentavos > configuredPinCentavos) {
    throw new PackageFundingConfigurationError(
      'Upgrade PIN price from ' + input.sourceLabel +
        ' does not fully fund retained-direct and package-binary allocations.',
    )
  }

  return {
    customerPayment: customerCentavos / 100,
    resellerValue: resellerCentavos / 100,
    acquisitionCost: acquisitionCentavos / 100,
    pinAllocation: configuredPinCentavos / 100,
    directAllocation: directCentavos / 100,
    binaryAllocation: binaryCentavos / 100,
    pointsDifference,
    productLineCount: input.products.length,
    units,
  }
}

export class UpgradeConfigurationError extends PackageFundingConfigurationError {}

export function normalizeUpgradePaths(value: unknown, targetPackageId: string): UpgradePathInput[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new UpgradeConfigurationError('Upgrade options must be a list.')

  const seenSources = new Set<string>()
  return value.map((raw, index) => {
    const path = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const fromPackageId = String(path.from_package_id || '').trim()
    const customerPrice = Number(path.customer_price)
    const pinPrice = Number(path.pin_price)
    const rawProducts = Array.isArray(path.products) ? path.products : []

    if (!fromPackageId || fromPackageId === targetPackageId) {
      throw new UpgradeConfigurationError(`Upgrade option ${index + 1} needs a different source package.`)
    }
    if (seenSources.has(fromPackageId)) {
      throw new UpgradeConfigurationError('Each source package can only have one upgrade option to this package.')
    }
    if (!Number.isFinite(customerPrice) || customerPrice <= 0 || !Number.isFinite(pinPrice) || pinPrice <= 0) {
      throw new UpgradeConfigurationError(`Upgrade option ${index + 1} needs valid customer and PIN prices.`)
    }
    if (rawProducts.length === 0) {
      throw new UpgradeConfigurationError(`Upgrade option ${index + 1} must include at least one product.`)
    }

    const seenProducts = new Set<string>()
    const products = rawProducts.map((rawProduct, productIndex) => {
      const product = rawProduct && typeof rawProduct === 'object' ? rawProduct as Record<string, unknown> : {}
      const productId = String(product.product_id || '').trim()
      const quantity = Number(product.quantity)
      if (!productId || !Number.isInteger(quantity) || quantity < 1) {
        throw new UpgradeConfigurationError(`Product ${productIndex + 1} in upgrade option ${index + 1} is invalid.`)
      }
      if (seenProducts.has(productId)) {
        throw new UpgradeConfigurationError(`Upgrade option ${index + 1} contains the same product more than once.`)
      }
      seenProducts.add(productId)
      return { product_id: productId, quantity }
    })

    seenSources.add(fromPackageId)
    return { from_package_id: fromPackageId, customer_price: customerPrice, pin_price: pinPrice, products }
  })
}
