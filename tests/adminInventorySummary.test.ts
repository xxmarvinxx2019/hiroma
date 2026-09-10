import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const route = readFileSync('src/app/api/admin/inventory/route.ts', 'utf8')
const page = readFileSync('src/app/dashboard/admin/inventory/page.tsx', 'utf8')

test('Admin inventory exposes company-wide physical stock totals independent of pagination', () => {
  assert.match(route, /where:\s*\{ owner_id: user\.id \}/)
  assert.match(route, /reserved_quantity: true/)
  assert.match(route, /adminPhysicalStock\.reduce/)
  assert.match(route, /activePhysicalProducts\.length - adminPhysicalStock\.length/)
  assert.match(route, /companyStockSummary:\s*\{[\s\S]*\.\.\.companyStockSummary,[\s\S]*distributed_units: totalDistributedUnits/)
  assert.match(page, /Company Stock on Hand/)
  assert.match(page, /Available to Distribute/)
  assert.match(page, /Current Stock Cost Value/)
  assert.match(page, /available · .*reserved/)
  assert.match(page, /Current Distributor Network Stock/)
  assert.match(page, /Recorded Reseller Purchases/)
  assert.match(page, /Reseller-held products are intentionally excluded/)
  assert.match(page, /Inventory audit breakdown/)
  assert.match(page, /Network & Reseller Records/)
  assert.match(page, /Reseller Purchases/)
  assert.match(page, /excluded from stock/)
})

test('Admin inventory global cards do not total only the paginated product rows', () => {
  assert.doesNotMatch(page, /productStock\.reduce\(\(s, p\) => s \+ p\.total_distributed/)
  assert.match(page, /companyStockSummary\.distributed_units/)
  assert.match(page, /companyStockSummary\.low_stock_products/)
  assert.match(route, /level === 'reseller'/)
  assert.match(route, /resellerMap\.set/)
  assert.match(route, /reseller_units:\s+resellerMap\.get/)
  assert.match(route, /reseller_units: resellerUnits/)
})
