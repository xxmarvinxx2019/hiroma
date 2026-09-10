import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

test('admin dashboard exposes audited all-time retained overflow', () => {
  const route = read('src/app/api/admin/stats/route.ts')
  const page = read('src/app/dashboard/admin/page.tsx')

  assert.match(route, /where:\s*\{\s*is_pair_overflow:\s*true\s*\}/)
  assert.match(route, /retainedOverflow\s*=\s*Number\(retainedOverflowRaw\._sum\.amount/)
  assert.match(route, /retainedOverflowEvents\s*=\s*retainedOverflowRaw\._count\.id/)
  assert.match(page, /label="Retained Overflow"/)
  assert.match(page, /commission-testing\/flushout-report/)
  assert.match(page, /all-time audited events/)
})

test('admin revenue cards expose read-only reconciled audit explanations', () => {
  const route = read('src/app/api/admin/stats/route.ts')
  const page = read('src/app/dashboard/admin/page.tsx')

  assert.match(route, /registration_channel channel/)
  assert.match(route, /GROUP BY package_name_snapshot, registration_channel/)
  assert.match(route, /GROUP BY type ORDER BY amount DESC/)
  assert.match(route, /SUM\(oi\.subtotal-p\.cost_price\*oi\.quantity\)/)
  assert.match(route, /revenueBreakdown:/)
  assert.match(page, /View explanation and audit breakdown/)
  assert.match(page, /Digital Net is not another PIN charge/)
  assert.match(page, /Source transaction economics|PIN allocation/)
  assert.match(page, /role="dialog"/)
  assert.match(page, /This modal is read-only/)
})
