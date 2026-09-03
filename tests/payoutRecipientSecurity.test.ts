import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  'prisma/migrations/20260901174000_enforce_reseller_only_payouts/migration.sql',
  'utf8',
)

test('database payout boundary rejects company and other non-reseller wallets', () => {
  assert.match(migration, /u\."role" <> 'reseller'::"Role"/)
  assert.match(migration, /recipient_role <> 'reseller'::"Role"/)
  assert.match(migration, /WHERE "id" = NEW\."user_id"\s+FOR SHARE/)
  assert.match(migration, /BEFORE INSERT OR UPDATE ON "payouts"/)
  assert.match(migration, /Payout recipient must be a reseller/)
})

test('reseller role changes cannot race or invalidate payout recipients', () => {
  assert.match(migration, /OLD\."role" = 'reseller'::"Role"/)
  assert.match(migration, /NEW\."role" <> 'reseller'::"Role"/)
  assert.match(migration, /FROM "payouts"\s+WHERE "user_id" = OLD\."id"/)
  assert.match(migration, /BEFORE UPDATE OF "role" ON "users"/)
  assert.match(migration, /users_preserve_reseller_payout_recipient/)
})

test('all active retained-income sinks resolve the protected Hiroma admin account', () => {
  const packageBinary = readFileSync('src/app/lib/binaryCommission.ts', 'utf8')
  const directReferral = readFileSync('src/app/lib/directReferral.ts', 'utf8')
  const productBinary = readFileSync('src/app/lib/productBinary.ts', 'utf8')
  const deactivation = readFileSync(
    'src/app/api/admin/resellers/[id]/status/route.ts',
    'utf8',
  )

  for (const source of [packageBinary, directReferral, deactivation]) {
    assert.match(source, /username: ['"]hiroma['"], role: ['"]admin['"], status: ['"]active['"]/)
  }
  assert.match(
    productBinary,
    /username='hiroma' AND role='admin'::"Role" AND status='active'::"UserStatus"/,
  )
})
