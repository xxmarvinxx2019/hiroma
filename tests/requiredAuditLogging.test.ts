import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('required audit logging awaits the supplied transaction and does not swallow failures', () => {
  const helper = readFileSync('src/app/lib/auditLog.ts', 'utf8')
  const required = helper.slice(
    helper.indexOf('export async function createRequiredAuditLog'),
    helper.indexOf('export function createAuditLog'),
  )
  assert.match(required, /await db\.\$executeRaw/)
  assert.doesNotMatch(required, /\.catch\(/)
})

test('sensitive admin mutations write required audit evidence inside their transactions', () => {
  const routes = [
    'src/app/api/admin/settings/profile/route.ts',
    'src/app/api/admin/resellers/[id]/route.ts',
    'src/app/api/admin/resellers/[id]/password-reset/route.ts',
    'src/app/api/admin/distributors/route.ts',
  ]

  for (const path of routes) {
    const source = readFileSync(path, 'utf8')
    assert.match(source, /prisma\.\$transaction\(async \(tx\) =>/)
    assert.match(source, /await createRequiredAuditLog\(tx,/)
  }
})

test('ordinary activity logging remains non-blocking', () => {
  const helper = readFileSync('src/app/lib/auditLog.ts', 'utf8')
  assert.match(helper, /void createRequiredAuditLog\(prisma, params\)/)
  assert.match(helper, /catch\(err => console\.error\('\[AUDIT LOG ERROR\]'/)
})
