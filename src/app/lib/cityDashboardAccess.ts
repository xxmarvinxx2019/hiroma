type CityDashboardViewer = {
  is_staff?: boolean | null
  permissions?: readonly string[] | null
}

export const CITY_DASHBOARD_FINANCIAL_KEYS = [
  'financialIntegrity',
  'registrationProfitToday',
  'registrationProfitYesterday',
  'resellerOrderProfitToday',
  'nonMemberProfitToday',
  'cityGrossProfitToday',
  'totalInventoryCost',
  'approvedRefundAmount',
  'netSalesAfterAdjustments',
  'totalCost',
  'totalProfit',
  'orderCost',
  'orderProfit',
  'packageCost',
  'packagePinRemittance',
  'packageCustomerPayments',
  'registrationProductProfit',
  'combinedProductRevenue',
  'combinedProductCost',
  'combinedProductProfit',
  'totalCustomerCashCollected',
] as const

export function canViewCityDashboardFinancials(viewer: CityDashboardViewer) {
  return viewer.is_staff !== true || viewer.permissions?.includes('reports') === true
}

/**
 * The city dashboard is shared by owners and delegated operational staff.
 * Redact cost and profit at the API boundary so hiding a card in React is
 * never the only protection for confidential branch financials.
 */
export function toCityDashboardDto<T extends Record<string, unknown>>(stats: T, canViewFinancials: boolean) {
  const dto: Record<string, unknown> = { ...stats, canViewFinancials }
  if (canViewFinancials) return dto as T & { canViewFinancials: true }

  for (const key of CITY_DASHBOARD_FINANCIAL_KEYS) delete dto[key]

  for (const key of ['resellerProductOrders', 'walkInProductOrders'] as const) {
    const row = dto[key]
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const operational = { ...(row as Record<string, unknown>) }
    delete operational.revenue
    delete operational.cost
    delete operational.profit
    dto[key] = operational
  }

  if (Array.isArray(dto.topProducts)) {
    dto.topProducts = dto.topProducts.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row
      const operational = { ...(row as Record<string, unknown>) }
      delete operational.revenue
      delete operational.cost
      return operational
    })
  }

  if (Array.isArray(dto.packageBreakdown)) {
    dto.packageBreakdown = dto.packageBreakdown.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row
      const operational = { ...(row as Record<string, unknown>) }
      delete operational.customer_payment
      delete operational.revenue
      delete operational.pin_allocation
      delete operational.cost
      delete operational.profit
      return operational
    })
  }

  if (Array.isArray(dto.topEarners)) {
    dto.topEarners = dto.topEarners.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row
      const operational = { ...(row as Record<string, unknown>) }
      delete operational.total_earned
      delete operational.balance
      return operational
    })
  }

  return dto as T & { canViewFinancials: false }
}
