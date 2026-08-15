import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  adminStaffPermissionForPath,
  cleanAdminStaffPermissions,
  firstAdminStaffRoute,
} from '../src/app/lib/staffPermissions'
import { isFreshStaffSessionAuthorized } from '../src/app/lib/staffSession'

test('admin staff routes require the matching checked permission', () => {
  assert.equal(adminStaffPermissionForPath('/dashboard/admin/support-center'), 'support_center:view')
  assert.equal(adminStaffPermissionForPath('/api/admin/payouts'), 'payouts:view')
  assert.equal(adminStaffPermissionForPath('/api/admin/payouts', 'PATCH'), 'payouts:process')
  assert.equal(adminStaffPermissionForPath('/api/admin/orders/abc', 'POST'), 'orders:manage')
  assert.equal(adminStaffPermissionForPath('/dashboard/admin/inventory'), 'inventory:view')
})

test('support API uses the checked view and reply permissions at the matching operation', () => {
  const route = readFileSync(new URL('../src/app/api/admin/support-requests/route.ts', import.meta.url), 'utf8')
  const messagesRoute = readFileSync(new URL('../src/app/api/support/tickets/[id]/messages/route.ts', import.meta.url), 'utf8')
  assert.match(route, /getAgent\("support_center:view"\)/)
  assert.match(route, /getAgent\("support_center:reply"\)/)
  assert.doesNotMatch(route, /permissions\?\.includes\("support_center"\)/)
  assert.match(messagesRoute, /accessTicket\(id, 'support_center:view'\)/)
  assert.match(messagesRoute, /accessTicket\(id, 'support_center:reply'\)/)
  assert.match(messagesRoute, /permissions\?\.includes\(requiredStaffPermission\)/)
  assert.match(messagesRoute, /ticket\.assigned_to === user\.actor_id/)
  assert.doesNotMatch(messagesRoute, /permissions\?\.includes\(['"]support_center['"]\)/)
})

test('sensitive and unknown admin areas remain owner-only', () => {
  assert.equal(adminStaffPermissionForPath('/dashboard/admin/support-staff'), '__owner_only__')
  assert.equal(adminStaffPermissionForPath('/api/admin/settings/password'), '__owner_only__')
  assert.equal(adminStaffPermissionForPath('/api/admin/commission-testing/product-binary'), '__owner_only__')
  assert.equal(adminStaffPermissionForPath('/api/admin/new-unclassified-feature'), '__owner_only__')
})

test('server permission cleaning rejects forged and duplicate values', () => {
  assert.deepEqual(cleanAdminStaffPermissions(['payouts:view', 'payouts:process', 'owner', 'payouts:view', 7]), ['payouts:view', 'payouts:process'])
  assert.deepEqual(cleanAdminStaffPermissions(['payouts:process']), [])
  assert.deepEqual(cleanAdminStaffPermissions('payouts:view'), [])
})

test('staff login lands on the first area it is allowed to use', () => {
  assert.equal(firstAdminStaffRoute(['support_center:view']), '/dashboard/admin/support-center')
  assert.equal(firstAdminStaffRoute(['payouts:view', 'reports:view']), '/dashboard/admin/payouts')
  assert.equal(firstAdminStaffRoute([]), '/login/admin')
})

test('fresh staff state immediately blocks removed access and deactivated accounts', () => {
  const active = { is_active: true, user_status: 'active', user_role: 'staff', user_login_disabled: false, owner_id: 'owner-1', owner_role: 'admin', owner_status: 'active', permissions: ['payouts:view'] }
  assert.equal(isFreshStaffSessionAuthorized('owner-1', 'admin', active, 'payouts:view'), true)
  assert.equal(isFreshStaffSessionAuthorized('owner-1', 'admin', active, 'payouts:process'), false)
  assert.equal(isFreshStaffSessionAuthorized('owner-1', 'admin', { ...active, is_active: false }, 'payouts:view'), false)
  assert.equal(isFreshStaffSessionAuthorized('owner-1', 'admin', { ...active, permissions: [] }, 'payouts:view'), false)
  assert.equal(isFreshStaffSessionAuthorized('owner-1', 'admin', { ...active, user_login_disabled: true }, 'payouts:view'), false)
  assert.equal(isFreshStaffSessionAuthorized('owner-1', 'admin', { ...active, user_role: 'admin' }, 'payouts:view'), false)
  assert.equal(isFreshStaffSessionAuthorized('different-owner', 'admin', active, 'payouts:view'), false)
})
