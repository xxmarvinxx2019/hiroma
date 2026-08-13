import assert from 'node:assert/strict'
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
