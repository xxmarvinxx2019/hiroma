import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

test('Admin reseller registration is blocked by the API and removed from the Admin UI', () => {
  const route = read('src/app/api/admin/resellers/register/route.ts')
  const page = read('src/app/dashboard/admin/resellers/page.tsx')

  assert.match(route, /Direct Admin reseller registration is disabled/)
  assert.match(route, /status:\s*403/)
  assert.doesNotMatch(page, /href="\/dashboard\/admin\/resellers\/register"/)
  assert.match(page, /Use an authorized City Distributor or Hiroma Branch account/)
})

test('legacy Admin registration page is redirected while City and Branch workflow remains available', () => {
  const middleware = read('src/middleware.ts')
  const cityPage = read('src/app/dashboard/city/resellers/page.tsx')
  const cityRoute = read('src/app/api/city/resellers/route.ts')

  assert.match(middleware, /role === 'admin'.*dashboard\/admin\/resellers\/register/)
  assert.match(middleware, /dashboard\/admin\/resellers'/)
  assert.match(cityPage, /dashboard\/city\/resellers\/register/)
  assert.match(cityRoute, /registrationOwnerProfile\?\.dist_level === "branch"/)
})
