import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('Admin reseller directory stays server-paginated and exposes stable database sorting', () => {
  const route = read('src/app/api/admin/resellers/route.ts')
  const page = read('src/app/dashboard/admin/resellers/page.tsx')

  assert.match(route, /const pageSize = Math\.min\(\s*50,/)
  assert.match(route, /ALLOWED_SORTS/)
  assert.match(route, /\{ created_at: 'desc' \}, \{ id: 'asc' \}/)
  assert.match(route, /last_name: \{ sort: 'asc', nulls: 'last' \}/)
  assert.match(route, /first_name: \{ sort: 'asc', nulls: 'last' \}/)
  assert.match(page, /Latest registered/)
  assert.match(page, /Last name A–Z/)
  assert.match(page, /new AbortController\(\)/)
  assert.match(page, /value=\{searchInput\}/)
})

test('Admin reseller search has production indexes for nationwide scale', () => {
  const migration = read('prisma/migrations/20260911120000_optimize_admin_reseller_directory/migration.sql')

  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_trgm/)
  assert.match(migration, /users_reseller_status_created_at_id_idx/)
  assert.match(migration, /users_reseller_last_name_first_name_id_idx/)
  assert.match(migration, /users_reseller_full_name_trgm_idx/)
  assert.match(migration, /users_reseller_username_trgm_idx/)
  assert.match(migration, /users_reseller_mobile_trgm_idx/)
})

test('structured reseller names are additive and preserve the existing full name', () => {
  const schema = read('prisma/schema.prisma')
  const registration = read('src/app/api/city/resellers/route.ts')
  const adminEdit = read('src/app/api/admin/resellers/[id]/route.ts')
  const migration = read('prisma/migrations/20260911120000_optimize_admin_reseller_directory/migration.sql')

  for (const field of ['first_name', 'middle_name', 'last_name', 'name_suffix']) {
    assert.match(schema, new RegExp(`${field}\\s+String\\?`))
    assert.match(migration, new RegExp(`ADD COLUMN "${field}" TEXT`))
  }
  assert.match(registration, /full_name: cleanFullName/)
  assert.match(registration, /first_name: cleanFirstName/)
  assert.match(registration, /last_name: cleanLastName/)
  assert.match(adminEdit, /full_name\.trim\(\) !== reseller\.full_name/)
  assert.match(adminEdit, /last_name: null/)
})
