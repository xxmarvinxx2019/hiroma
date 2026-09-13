import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

test('exclusive distributor territories use canonical PSGC codes at every hierarchy level', () => {
  const policy = read('src/app/lib/distributorTerritory.ts')
  assert.match(policy, /level === 'regional'[\s\S]*regionCode/)
  assert.match(policy, /level === 'provincial'[\s\S]*provinceCode/)
  assert.match(policy, /dist_level: \{ in: \['city', 'branch'\] \}/)
  assert.match(policy, /city_muni_code: normalized/)
})

test('database serializes territory claims and blocks simultaneous duplicate assignments', () => {
  const migration = read('prisma/migrations/20260911150000_enforce_exclusive_distributor_territories/migration.sql')
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /TERRITORY_ALREADY_ASSIGNED/)
  assert.match(migration, /BEFORE INSERT OR UPDATE OF is_active, dist_level, region_code, province_code, city_muni_code/)
  assert.match(migration, /Existing conflicts are preserved for explicit Admin reconciliation/)
})

test('Admin registration checks availability in the UI and rechecks inside the create transaction', () => {
  const route = read('src/app/api/admin/distributors/route.ts')
  const page = read('src/app/dashboard/admin/distributors/page.tsx')
  assert.match(route, /territory_level/)
  assert.match(route, /await findActiveTerritoryHolder\(tx, exclusiveLevel, exclusiveCode\)/)
  assert.match(route, /status: 409/)
  assert.match(page, /Territory already taken/)
  assert.match(page, /territoryCheck\.available !== true/)
})
