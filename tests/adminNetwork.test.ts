import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

test('Admin network explorer is read-only, bounded, and searchable', () => {
  const route = read('src/app/api/admin/network/route.ts')

  assert.match(route, /export async function GET/)
  assert.doesNotMatch(route, /export async function (POST|PATCH|PUT|DELETE)/)
  assert.match(route, /Math\.min\(Math\.max\(requestedDepth, 1\), 3\)/)
  assert.match(route, /LIMIT 20/)
  assert.match(route, /WITH RECURSIVE subtree/)
  assert.match(route, /currentUser\.role !== 'admin'/)
})

test('Admin network shows sponsor and binary placement as separate relationships', () => {
  const route = read('src/app/api/admin/network/route.ts')
  const page = read('src/app/dashboard/admin/network/page.tsx')

  assert.match(route, /sponsor_username/)
  assert.match(route, /parent_username/)
  assert.match(page, /Sponsor:/)
  assert.match(page, /Binary parent:/)
  assert.match(page, /Sponsor and binary parent may be different/)
  assert.match(page, /Read-only safeguard/)
})

test('Admin navigation exposes Binary Tree through reseller-view permission', () => {
  const layout = read('src/app/dashboard/admin/layout.tsx')
  const permissions = read('src/app/lib/staffPermissions.ts')

  assert.match(layout, /section: 'Network'/)
  assert.match(layout, /\/dashboard\/admin\/network/)
  assert.match(permissions, /dashboard\/admin\/network/)
  assert.match(permissions, /api\/admin\/network/)
})
