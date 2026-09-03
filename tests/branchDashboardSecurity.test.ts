import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { escapeHtmlText, escapeHtmlTextValues } from '../src/app/lib/html'
import { isFreshStaffSessionAuthorized } from '../src/app/lib/staffSession'

const read = (path: string) => readFileSync(path, 'utf8')

test('print receipt text is encoded without changing ordinary labels', () => {
  assert.equal(escapeHtmlText('Cash / GCash'), 'Cash / GCash')
  assert.equal(
    escapeHtmlText('</span><script>window.opener.fetch("/api/city/staff")</script>'),
    '&lt;/span&gt;&lt;script&gt;window.opener.fetch(&quot;/api/city/staff&quot;)&lt;/script&gt;',
  )

  const page = read('src/app/dashboard/city/orders/[id]/page.tsx')
  assert.match(page, /escapeHtmlText\(order\.payment_reference\)/)
  assert.match(page, /escapeHtmlText\(item\.product\?\.name/)
  assert.match(page, /printWindow\.opener = null/)
  assert.doesNotMatch(page, /<script>window\.onload/)
})

test('every order receipt escapes nested persisted text before document.write', () => {
  const ordinary = {
    order_number: 'ORD-100',
    total_amount: 1250,
    buyer: { full_name: 'Juan Dela Cruz' },
    items: [{ quantity: 2, product: { name: 'Oil & Soap' } }],
  }
  const escaped = escapeHtmlTextValues({
    ...ordinary,
    buyer: { full_name: '</div><script>window.opener.fetch("/api/admin")</script>' },
    items: [{ quantity: 2, product: { name: '<img src=x onerror=alert(1)>' } }],
  })

  assert.deepEqual(escapeHtmlTextValues(ordinary), {
    ...ordinary,
    items: [{ quantity: 2, product: { name: 'Oil &amp; Soap' } }],
  })
  assert.equal(escaped.total_amount, 1250)
  assert.equal(escaped.buyer.full_name.includes('<script>'), false)
  assert.equal(escaped.items[0].product.name.includes('<img'), false)

  for (const role of ['reseller', 'regional', 'provincial', 'admin']) {
    const page = read(`src/app/dashboard/${role}/orders/[id]/page.tsx`)
    assert.match(page, /escapeHtmlTextValues\(rawOrder\)/)
    assert.match(page, /printWindow\.document\.write\(html\)/)
  }
})

test('city staff first-login password change targets the actor, never the branch owner', () => {
  const proxy = read('src/proxy.ts')
  const route = read('src/app/api/city/profile/password/route.ts')

  assert.ok(
    proxy.indexOf("pathname === '/api/city/profile/password'") <
      proxy.indexOf("pathname.startsWith('/dashboard/city/profile')"),
  )
  assert.match(route, /const accountId = user\.is_staff \? user\.actor_id : user\.id/)
  assert.match(route, /where: \{ id: accountId \}/)
  assert.doesNotMatch(route, /where: \{ id: user\.id \}/)
  assert.match(route, /user_role: user\.is_staff \? 'staff' : user\.role/)
})

test('reseller list and genealogy APIs cap client-controlled page sizes', () => {
  for (const routePath of [
    'src/app/api/admin/resellers/route.ts',
    'src/app/api/regional/resellers/route.ts',
    'src/app/api/provincial/resellers/route.ts',
    'src/app/api/city/resellers/route.ts',
    'src/app/api/reseller/genealogy/route.ts',
  ]) {
    const route = read(routePath)
    assert.match(route, /const pageSize = Math\.min\(\s*50,/)
  }
})

test('fresh staff authorization supports composite route permissions and immediate removal', () => {
  const snapshot = {
    is_active: true,
    user_status: 'active',
    user_role: 'staff',
    user_login_disabled: false,
    owner_id: 'branch-1',
    owner_role: 'city',
    owner_status: 'active',
    permissions: ['pos_approve', 'deposit_submit'],
  }

  assert.equal(isFreshStaffSessionAuthorized('branch-1', 'city', snapshot, 'pos|pos_approve'), true)
  assert.equal(isFreshStaffSessionAuthorized('branch-1', 'city', snapshot, 'reports|deposit_submit|deposit_confirm'), true)
  assert.equal(isFreshStaffSessionAuthorized('branch-1', 'city', { ...snapshot, permissions: [] }, 'pos|pos_approve'), false)
  assert.equal(isFreshStaffSessionAuthorized('branch-1', 'city', snapshot, '__owner_only__'), false)

  const proxy = read('src/proxy.ts')
  assert.match(proxy, /payload\.is_staff === true && requiredPermission/)
  assert.doesNotMatch(proxy, /payload\.is_staff === true && role === 'admin' && requiredPermission/)
  assert.match(proxy, /requestHeaders\.delete\('x-hiroma-staff-permission'\)/)
})

test('placement options performs route-level city authentication before querying tree data', () => {
  const route = read('src/app/api/city/resellers/placement-options/route.ts')
  const auth = route.indexOf('await getCurrentUser()')
  const query = route.indexOf('prisma.user.findUnique')
  assert.ok(auth >= 0 && query > auth)
  assert.match(route, /!user \|\| user\.role !== 'city'/)
  assert.match(route, /\{ error: 'Unauthorized' \}, \{ status: 401 \}/)
})

test('reseller package upgrade claims the expected package and uses issued points before side effects', () => {
  const route = read('src/app/api/city/resellers/upgrade/route.ts')
  const profileClaim = route.indexOf('tx.resellerProfile.updateMany')
  const pinClaim = route.indexOf('claimUnusedPin(tx, pin.id')
  const financial = route.indexOf('tx.upgradeFinancial.create')
  assert.ok(profileClaim >= 0 && pinClaim > profileClaim && financial > pinClaim)
  assert.match(route, /package_id: resellerProfile\.package_id/)
  assert.match(route, /claimedProfile\.count !== 1/)
  assert.match(route, /error instanceof ResellerUpgradeConflictError[\s\S]*status: 409/)
  assert.doesNotMatch(route, /tx\.resellerProfile\.update\(\{\s*where: \{ user_id: reseller_id \}/)
  assert.match(route, /const diffPts = Number\(pin\.upgrade_points_difference_snapshot\)/)
  assert.doesNotMatch(route, /const diffPts = newPts - oldPts/)
})

test('inventory-only audit responses keep quantities but redact monetary fields', () => {
  const ledger = read('src/app/api/city/inventory/audit-ledger/route.ts')
  const audits = read('src/app/api/city/inventory/audits/route.ts')
  const detail = read('src/app/api/city/inventory/audits/[id]/route.ts')
  const workspace = read('src/app/dashboard/city/inventory/InventoryAuditWorkspace.tsx')

  for (const route of [ledger, audits, detail]) {
    assert.match(route, /canViewCityDashboardFinancials\(user\)/)
    assert.match(route, /can_view_financials: canViewFinancials/)
  }
  assert.match(ledger, /reference_type: \{ not: 'branch_cash_deposit' \}/)
  assert.match(ledger, /unit_cost: canViewFinancials \? row\.unit_cost : null/)
  assert.match(ledger, /total_movement_value: canViewFinancials/)
  assert.match(audits, /variance_value: canViewFinancials \? varianceValue : null/)
  assert.match(detail, /unit_cost_snapshot: canViewFinancials \? Number\(item\.unit_cost_snapshot\) : null/)
  assert.match(detail, /variance_value: new Prisma\.Decimal\(update\.variance \* Number\(update\.item\.unit_cost_snapshot\)\)/)
  assert.match(workspace, /Reports access required/)
  assert.match(workspace, /canViewFinancials && variance !== null/)
})
