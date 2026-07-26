export interface PackageEconomicProduct {
  quantity: number
  product: {
    price: unknown
    reseller_price: unknown
  }
}

export function calculatePackageEconomics(products: PackageEconomicProduct[]) {
  return products.reduce((totals, item) => {
    const srp = Number(item.product.price || 0)
    const resellerPrice = Number(item.product.reseller_price) || srp
    totals.customerPayment += srp * item.quantity
    totals.resellerValue += resellerPrice * item.quantity
    totals.pinAllocation += Math.max(0, srp - resellerPrice) * item.quantity
    return totals
  }, { customerPayment: 0, resellerValue: 0, pinAllocation: 0 })
}
