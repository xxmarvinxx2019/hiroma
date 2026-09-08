import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { canCompleteMaintenanceSecurityPin, decideMaintenanceAccess } from '../src/app/lib/maintenancePolicy'
import { parseMaintenanceState } from '../src/app/lib/maintenanceState'

const source = (path: string) => readFileSync(path, 'utf8')

describe('maintenance access policy', () => {
  it('does not alter requests while maintenance is off', () => {
    assert.equal(decideMaintenanceAccess({ pathname: '/api/city/resellers', method: 'POST', active: false, isOwnerAdmin: false }), 'allow')
  })

  it('blocks normal APIs and pages while maintenance is active', () => {
    assert.equal(decideMaintenanceAccess({ pathname: '/api/city/resellers', method: 'POST', active: true, isOwnerAdmin: false }), 'block-api')
    assert.equal(decideMaintenanceAccess({ pathname: '/api/cron/release-payouts', method: 'GET', active: true, isOwnerAdmin: false }), 'block-api')
    assert.equal(decideMaintenanceAccess({ pathname: '/dashboard/reseller', method: 'GET', active: true, isOwnerAdmin: false }), 'redirect')
    assert.equal(decideMaintenanceAccess({ pathname: '/login/member', method: 'GET', active: true, isOwnerAdmin: false }), 'redirect')
  })

  it('allows only owner reads and exact recovery paths', () => {
    assert.equal(decideMaintenanceAccess({ pathname: '/dashboard/admin/reports', method: 'GET', active: true, isOwnerAdmin: true }), 'allow')
    assert.equal(decideMaintenanceAccess({ pathname: '/api/admin/reports', method: 'GET', active: true, isOwnerAdmin: true }), 'allow')
    assert.equal(decideMaintenanceAccess({ pathname: '/api/admin/payouts', method: 'PATCH', active: true, isOwnerAdmin: true }), 'block-api')
    assert.equal(decideMaintenanceAccess({ pathname: '/api/orders/fake.json', method: 'PATCH', active: true, isOwnerAdmin: false }), 'block-api')
    assert.equal(decideMaintenanceAccess({ pathname: '/api/admin/maintenance', method: 'PATCH', active: true, isOwnerAdmin: false }), 'allow')
    assert.equal(decideMaintenanceAccess({ pathname: '/api/admin/maintenance/other', method: 'PATCH', active: true, isOwnerAdmin: true }), 'block-api')
  })

  it('reaches only the Security PIN handler for owner recovery', () => {
    assert.equal(decideMaintenanceAccess({ pathname: '/api/auth/login/pin', method: 'POST', active: true, isOwnerAdmin: false }), 'allow')
    assert.equal(canCompleteMaintenanceSecurityPin({ active: true, challengeRole: 'admin' }), true)
    assert.equal(canCompleteMaintenanceSecurityPin({ active: true, challengeRole: 'reseller' }), false)
    assert.equal(canCompleteMaintenanceSecurityPin({ active: true, challengeRole: 'staff' }), false)
    assert.equal(canCompleteMaintenanceSecurityPin({ active: false, challengeRole: 'reseller' }), true)
  })
})

describe('maintenance setting state', () => {
  it('defaults safely to off when no setting has been created', () => {
    const state = parseMaintenanceState([])
    assert.equal(state.enabled, false)
    assert.equal(state.startedAt, null)
  })

  it('parses the authoritative database settings', () => {
    const updated = new Date('2026-09-04T01:00:00.000Z')
    const state = parseMaintenanceState([
      { key: 'maintenance_mode', value: 'on', updated_at: updated, updated_by: 'admin-1' },
      { key: 'maintenance_message', value: 'Deploying a protected update.', updated_at: updated, updated_by: 'admin-1' },
      { key: 'maintenance_started_at', value: updated.toISOString(), updated_at: updated, updated_by: 'admin-1' },
    ])
    assert.equal(state.enabled, true)
    assert.equal(state.message, 'Deploying a protected update.')
    assert.equal(state.startedAt, updated.toISOString())
    assert.equal(state.updatedBy, 'admin-1')
  })
})

describe('maintenance implementation boundaries', () => {
  it('keeps the control owner-only, same-origin, serialized, and audited', () => {
    const route = source('src/app/api/admin/maintenance/route.ts')
    assert.match(route, /user\?\.role === 'admin' && user\.is_staff !== true/)
    assert.match(route, /new URL\(origin\)\.origin === req\.nextUrl\.origin/)
    assert.match(route, /pg_advisory_xact_lock/)
    assert.match(route, /createRequiredAuditLog/)
    assert.match(route, /maintenance_mode_enabled/)
    assert.match(route, /maintenance_mode_disabled/)
  })

  it('fails closed and returns 503 for blocked APIs', () => {
    const proxy = source('src/proxy.ts')
    assert.match(proxy, /return \{[\s\S]*enabled: true,\s*unavailable: true/)
    assert.match(proxy, /status: 503/)
    assert.match(proxy, /Retry-After/)
    assert.doesNotMatch(proxy, /pathname\.includes\('\.'\)/)
  })

  it('blocks non-owner password logins before a session is issued', () => {
    const login = source('src/app/api/auth/login/route.ts')
    const maintenanceCheck = login.indexOf("if (user.role !== 'admin')")
    const tokenIssue = login.indexOf('const token = await signToken(payload)')
    assert.ok(maintenanceCheck > -1)
    assert.ok(tokenIssue > maintenanceCheck)
    assert.match(login, /maintenance_login_blocked/)
    assert.match(login, /status: 503/)
  })

  it('permits only a signed Admin Security PIN challenge to complete during maintenance', () => {
    const login = source('src/app/api/auth/login/route.ts')
    const pin = source('src/app/api/auth/login/pin/route.ts')
    const maintenanceCheck = pin.indexOf('canCompleteMaintenanceSecurityPin')
    const sessionIssue = pin.indexOf('await setAuthCookie')
    assert.ok(maintenanceCheck > -1)
    assert.ok(sessionIssue > maintenanceCheck)
    assert.match(login, /user\.role !== 'staff' && isSecurityPinEligibleRole/)
    assert.match(pin, /getMaintenanceState/)
    assert.match(pin, /user\.role !== challenge\.role/)
    assert.match(pin, /await deleteTwoFactorChallengeCookie\(\)/)
    assert.match(pin, /Security PIN sign-in completion was paused by maintenance mode/)
    assert.match(pin, /status: 503/)
  })

  it('exposes the owner-only sidebar control and public notice', () => {
    assert.match(source('src/app/dashboard/admin/layout.tsx'), /dashboard\/admin\/maintenance/)
    assert.match(source('src/app/lib/staffPermissions.ts'), /dashboard\/admin\/maintenance.*__owner_only__/)
    assert.match(source('src/app/maintenance/page.tsx'), /No transaction will be accepted/)
    const adminPage = source('src/app/dashboard/admin/maintenance/page.tsx')
    assert.match(adminPage, /Choose the production state/)
    assert.match(adminPage, /aria-pressed=\{targetEnabled === false\}/)
    assert.match(adminPage, /aria-pressed=\{targetEnabled === true\}/)
  })
})
