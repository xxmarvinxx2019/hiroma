import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', override: true })

const appUrl = process.env.BRANCH_READINESS_URL || 'http://localhost:3003'
const databaseUrl = process.env.DATABASE_URL || ''
const databaseHost = new URL(databaseUrl).hostname

if (!['127.0.0.1', 'localhost', '::1'].includes(databaseHost)) {
  throw new Error('Branch readiness verification is blocked unless DATABASE_URL points to localhost.')
}

const credentials = {
  owner: { username: 'posbranch', password: process.env.BRANCH_TEST_OWNER_PASSWORD },
  cashier: { username: 'poscashier', password: process.env.BRANCH_TEST_CASHIER_PASSWORD },
  approver: { username: 'posapprover', password: process.env.BRANCH_TEST_APPROVER_PASSWORD },
}

for (const [role, credential] of Object.entries(credentials)) {
  if (!credential.password) throw new Error(`Missing local ${role} readiness password.`)
}

type Session = { cookie: string; username: string }

async function login(username: string, password: string): Promise<Session> {
  const response = await fetch(`${appUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Hiroma-Branch-Readiness/1.0' },
    body: JSON.stringify({ username, password, portal: 'distributor' }),
  })
  const body = await response.json() as { error?: string; requires_pin?: boolean }
  assert.equal(response.status, 200, `${username} login failed: ${body.error || response.status}`)
  assert.notEqual(body.requires_pin, true, `${username} requires an interactive security PIN.`)
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  assert.ok(cookie, `${username} login did not issue a session cookie.`)
  return { cookie, username }
}

async function request(session: Session | null, path: string) {
  const response = await fetch(`${appUrl}${path}`, {
    headers: {
      ...(session ? { Cookie: session.cookie } : {}),
      'User-Agent': 'Hiroma-Branch-Readiness/1.0',
    },
    cache: 'no-store',
  })
  const text = await response.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { response, body }
}

function recordResult(label: string) {
  process.stdout.write(`PASS ${label}\n`)
}

async function main() {
  const { default: prisma } = await import('../src/app/lib/prisma')
  let originalCashierPermissions: unknown = null
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
  const fixtureUsername = `readiness_${suffix}`
  const fixtureMemberId = `READY-${suffix}`
  const fixturePinPrefix = `READY-${suffix}`
  const packageIds: string[] = []

  try {
    const owner = await login(credentials.owner.username, credentials.owner.password!)
    const cashier = await login(credentials.cashier.username, credentials.cashier.password!)
    const approver = await login(credentials.approver.username, credentials.approver.password!)
    recordResult('owner, cashier, and approver authenticate through the real login API')

    const ownerStats = await request(owner, '/api/city/stats?period=today')
    assert.equal(ownerStats.response.status, 200)
    recordResult('branch owner can load dashboard statistics')

    const unauthenticatedPlacement = await request(null, '/api/city/resellers/placement-options?referrer=posmember')
    assert.equal(unauthenticatedPlacement.response.status, 401)
    const authenticatedPlacement = await request(owner, '/api/city/resellers/placement-options')
    assert.equal(authenticatedPlacement.response.status, 400)
    recordResult('placement options rejects unauthenticated access before validating input')

    const cashierAudits = await request(cashier, '/api/city/inventory/audits')
    assert.equal(cashierAudits.response.status, 200)
    assert.equal((cashierAudits.body as { access?: { can_view_financials?: boolean } }).access?.can_view_financials, false)
    const cashierLedger = await request(cashier, '/api/city/inventory/audit-ledger?pageSize=10')
    assert.equal(cashierLedger.response.status, 200)
    const ledgerBody = cashierLedger.body as { access?: { can_view_financials?: boolean }; rows?: Array<{ unit_cost?: number | null; total_value?: number | null }> }
    assert.equal(ledgerBody.access?.can_view_financials, false)
    for (const row of ledgerBody.rows || []) {
      assert.equal(row.unit_cost, null)
      assert.equal(row.total_value, null)
    }
    recordResult('inventory-only cashier receives operational quantities without acquisition costs')

    const approverAudits = await request(approver, '/api/city/inventory/audits')
    assert.equal(approverAudits.response.status, 200)
    assert.equal((approverAudits.body as { access?: { can_view_financials?: boolean } }).access?.can_view_financials, true)
    recordResult('reports-authorized approver retains financial audit access')

    const cashierUser = await prisma.user.findUnique({ where: { username: credentials.cashier.username }, select: { id: true, staff_profile: { select: { permissions: true } } } })
    assert.ok(cashierUser?.staff_profile)
    originalCashierPermissions = cashierUser.staff_profile.permissions
    await prisma.staffProfile.update({ where: { user_id: cashierUser.id }, data: { permissions: ['pos'] } })

    const revokedInventory = await request(cashier, '/api/city/inventory')
    assert.ok([401, 403].includes(revokedInventory.response.status), `Expected revoked inventory access, received ${revokedInventory.response.status}`)
    await prisma.staffProfile.update({ where: { user_id: cashierUser.id }, data: { permissions: originalCashierPermissions as never } })
    originalCashierPermissions = null
    const restoredInventory = await request(cashier, '/api/city/inventory')
    assert.equal(restoredInventory.response.status, 200)
    recordResult('permission removal takes effect on the existing session and restoration preserves legitimate access')

    const ownerUser = await prisma.user.findUnique({ where: { username: credentials.owner.username }, select: { id: true } })
    assert.ok(ownerUser)
    const packages = await Promise.all(['A', 'B', 'C'].map((label, index) => prisma.package.create({
      data: {
        name: `Branch Readiness ${suffix} ${label}`,
        price: 100 + index,
        direct_referral_bonus: 0,
        pairing_bonus_value: index,
        point_php_value: 0,
        is_active: false,
      },
    })))
    packageIds.push(...packages.map((item) => item.id))
    const reseller = await prisma.user.create({
      data: {
        member_id: fixtureMemberId,
        username: fixtureUsername,
        full_name: 'Temporary Branch Readiness Reseller',
        mobile: `09${suffix.slice(0, 9)}`,
        password_hash: 'temporary-readiness-only',
        role: 'reseller',
        status: 'active',
        created_by: ownerUser.id,
      },
    })
    const registrationPin = await prisma.pin.create({
      data: {
        pin_code: `${fixturePinPrefix}-REG`,
        package_id: packages[0].id,
        city_dist_id: ownerUser.id,
        generated_by: ownerUser.id,
        status: 'used',
        used_by: reseller.id,
        used_at: new Date(),
      },
    })
    const upgradePins = await Promise.all([packages[1], packages[2]].map((target, index) => prisma.pin.create({
      data: {
        pin_code: `${fixturePinPrefix}-UP${index + 1}`,
        package_id: target.id,
        city_dist_id: ownerUser.id,
        generated_by: ownerUser.id,
        status: 'unused',
        pin_type: 'upgrade',
        upgrade_from_package_id: packages[0].id,
      },
    })))
    await prisma.resellerProfile.create({
      data: {
        user_id: reseller.id,
        package_id: packages[0].id,
        city_dist_id: ownerUser.id,
        pin_id: registrationPin.id,
      },
    })

    const claimUpgrade = (pinId: string, targetPackageId: string) => prisma.$transaction(async (tx) => {
      const claimedProfile = await tx.resellerProfile.updateMany({
        where: { user_id: reseller.id, city_dist_id: ownerUser.id, package_id: packages[0].id },
        data: { package_id: targetPackageId },
      })
      if (claimedProfile.count !== 1) throw new Error('upgrade_conflict')
      const claimedPin = await tx.pin.updateMany({
        where: { id: pinId, status: 'unused' },
        data: { status: 'used', used_by: reseller.id, used_at: new Date() },
      })
      assert.equal(claimedPin.count, 1)
    })
    const concurrent = await Promise.allSettled([
      claimUpgrade(upgradePins[0].id, packages[1].id),
      claimUpgrade(upgradePins[1].id, packages[2].id),
    ])
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1)
    const pinStates = await prisma.pin.findMany({ where: { id: { in: upgradePins.map((pin) => pin.id) } }, select: { status: true } })
    assert.equal(pinStates.filter((pin) => pin.status === 'used').length, 1)
    assert.equal(pinStates.filter((pin) => pin.status === 'unused').length, 1)
    recordResult('real PostgreSQL compare-and-swap allows only one concurrent package upgrade and leaves the losing PIN unused')
  } finally {
    if (originalCashierPermissions !== null) {
      const cashier = await prisma.user.findUnique({ where: { username: credentials.cashier.username }, select: { id: true } })
      if (cashier) await prisma.staffProfile.update({ where: { user_id: cashier.id }, data: { permissions: originalCashierPermissions as never } })
    }
    await prisma.resellerProfile.deleteMany({ where: { user: { username: fixtureUsername } } })
    await prisma.pin.deleteMany({ where: { pin_code: { startsWith: fixturePinPrefix } } })
    await prisma.user.deleteMany({ where: { username: fixtureUsername } })
    if (packageIds.length) await prisma.package.deleteMany({ where: { id: { in: packageIds } } })
    const [fixtureUsers, fixturePins, fixturePackages, restoredCashier] = await Promise.all([
      prisma.user.count({ where: { username: fixtureUsername } }),
      prisma.pin.count({ where: { pin_code: { startsWith: fixturePinPrefix } } }),
      prisma.package.count({ where: { id: { in: packageIds } } }),
      prisma.user.findUnique({ where: { username: credentials.cashier.username }, select: { staff_profile: { select: { permissions: true } } } }),
    ])
    const restoredPermissions = Array.isArray(restoredCashier?.staff_profile?.permissions)
      ? restoredCashier.staff_profile.permissions
      : []
    assert.deepEqual({ fixtureUsers, fixturePins, fixturePackages }, { fixtureUsers: 0, fixturePins: 0, fixturePackages: 0 })
    assert.equal(restoredPermissions.includes('inventory'), true)
    recordResult('temporary readiness fixtures were removed and cashier permissions were restored')
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
