import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  canViewCityDashboardFinancials,
  CITY_DASHBOARD_FINANCIAL_KEYS,
  toCityDashboardDto,
} from '../src/app/lib/cityDashboardAccess'

const read = (path: string) => readFileSync(path, 'utf8')

test('city dashboard financial access follows owner and Reports permission boundaries', () => {
  assert.equal(canViewCityDashboardFinancials({ is_staff: false, permissions: [] }), true)
  assert.equal(canViewCityDashboardFinancials({ is_staff: true, permissions: ['dashboard', 'reports'] }), true)
  assert.equal(canViewCityDashboardFinancials({ is_staff: true, permissions: ['dashboard', 'inventory'] }), false)
  assert.equal(canViewCityDashboardFinancials({ is_staff: true, permissions: ['dashboard', 'orders'] }), false)
})

test('dashboard-only DTO removes cost, profit, refunds, and detailed registration cash', () => {
  const source = {
    totalRevenue: 1000,
    totalCost: 600,
    totalProfit: 400,
    approvedRefundAmount: 50,
    netSalesAfterAdjustments: 950,
    packageCustomerPayments: 500,
    totalCustomerCashCollected: 1500,
    resellerProductOrders: { revenue: 700, cost: 400, profit: 300, units: 7 },
    walkInProductOrders: { revenue: 300, cost: 200, profit: 100, units: 3 },
    topProducts: [{ product_id: 'p1', name: 'One', qty: 10, revenue: 1000, cost: 600 }],
    packageBreakdown: [{ package_id: 'pkg', name: 'Starter', count: 1, units: 3, customer_payment: 500, revenue: 400, pin_allocation: 100, cost: 250, profit: 150 }],
    topEarners: [{ id: 'r1', full_name: 'Reseller', total_earned: 200, balance: 50 }],
  }
  const limited = toCityDashboardDto(source, false) as Record<string, unknown>

  for (const key of CITY_DASHBOARD_FINANCIAL_KEYS) assert.equal(key in limited, false, `${key} must be redacted`)
  assert.equal(limited.totalRevenue, 1000)
  assert.deepEqual(limited.resellerProductOrders, { units: 7 })
  assert.deepEqual(limited.walkInProductOrders, { units: 3 })
  assert.deepEqual(limited.topProducts, [{ product_id: 'p1', name: 'One', qty: 10 }])
  assert.deepEqual(limited.packageBreakdown, [{ package_id: 'pkg', name: 'Starter', count: 1, units: 3 }])
  assert.deepEqual(limited.topEarners, [{ id: 'r1', full_name: 'Reseller' }])
})

test('owner DTO retains the complete financial payload', () => {
  const source = { totalRevenue: 1000, totalCost: 600, totalProfit: 400 }
  assert.deepEqual(toCityDashboardDto(source, true), { ...source, canViewFinancials: true })
})

test('city stats applies DTO redaction at the API boundary and separates order directions', () => {
  const route = read('src/app/api/city/stats/route.ts')
  assert.match(route, /toCityDashboardDto\(stats, canViewFinancials\)/)
  assert.match(route, /canViewCityDashboardFinancials\(user\)/)
  assert.match(route, /pendingCustomerOrders[\s\S]*seller_id: user\.id, status: 'pending'/)
  assert.match(route, /pendingStockOrders: canUseOrders \? pendingOrders : 0/)
  assert.match(route, /lowStockItems: canUseInventory \? lowStockItems : 0/)
  assert.match(route, /prisma\.order\.count\(\{ where: \{ buyer_id: user\.id, status: 'pending' \} \}\)/)
  assert.match(route, /status: 'approved'[\s\S]*request_type: 'refund'[\s\S]*transaction: \{ order: \{ status: 'delivered' \} \}/)
})

test('dashboard UI gates financial reports and provides actionable resilient states', () => {
  const page = read('src/app/dashboard/city/page.tsx')
  assert.match(page, /stats\.canViewFinancials && tab === 'sales'/)
  assert.match(page, /stats\.canViewFinancials && tab === 'products'/)
  assert.match(page, /stats\.canViewFinancials && tab === 'packages'/)
  assert.match(page, /Pending Stock Orders/)
  assert.match(page, /Customer orders to fulfill/)
  assert.match(page, /Manager Action Center/)
  assert.match(page, /response\.ok/)
  assert.match(page, /Showing the last successfully loaded figures/)
  assert.match(page, /Last updated/)
  assert.match(page, /timeZone: 'Asia\/Manila'/)
  assert.match(page, /Net sales after refunds/)
})

test('low-stock dashboard link opens a threshold-aware inventory filter', () => {
  const page = read('src/app/dashboard/city/page.tsx')
  const inventoryPage = read('src/app/dashboard/city/inventory/page.tsx')
  const inventoryRoute = read('src/app/api/city/inventory/route.ts')
  assert.match(page, /\/dashboard\/city\/inventory\?stock=low/)
  assert.match(inventoryPage, /searchParams\.get\('stock'\)/)
  assert.match(inventoryRoute, /lte: prisma\.inventory\.fields\.low_stock_threshold/)
  assert.match(inventoryRoute, /gt: prisma\.inventory\.fields\.low_stock_threshold/)
})
