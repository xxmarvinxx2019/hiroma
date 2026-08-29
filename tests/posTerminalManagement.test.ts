import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const route = readFileSync('src/app/api/city/pos/terminals/route.ts', 'utf8')
const bootstrap = readFileSync('src/app/api/city/pos/bootstrap/route.ts', 'utf8')

test('terminal management is restricted to a non-staff city owner', () => {
  assert.match(route, /user\.role !== 'city' \|\| user\.is_staff/)
  assert.match(route, /Owner access required/)
})

test('terminal reads and writes are scoped to the authenticated owner', () => {
  assert.match(route, /where: \{ owner_id: owner\.id \}/)
  assert.match(route, /id: terminalId, owner_id: owner\.id/)
})

test('management response never exposes the browser installation secret', () => {
  const selectBlock = route.slice(route.indexOf('select: {'), route.indexOf('return NextResponse.json({ terminals })'))
  assert.doesNotMatch(selectBlock, /installation_id/)
})

test('terminal state changes use an atomic compare-and-update and required audit log', () => {
  assert.match(route, /updateMany/)
  assert.match(route, /is_active: current\.is_active/)
  assert.match(route, /createRequiredAuditLog/)
  assert.match(route, /pos_terminal_deactivated/)
  assert.match(route, /pos_terminal_reactivated/)
})

test('a disabled terminal remains blocked during POS bootstrap', () => {
  assert.match(bootstrap, /existing && !existing\.is_active/)
  assert.match(bootstrap, /terminal has been disabled/i)
  assert.match(bootstrap, /status: 403/)
})
