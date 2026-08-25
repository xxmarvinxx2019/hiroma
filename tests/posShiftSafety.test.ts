import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
const migration = fs.readFileSync('prisma/migrations/20260825123000_guard_single_open_pos_shift/migration.sql', 'utf8')
const route = fs.readFileSync('src/app/api/city/pos/shifts/route.ts', 'utf8')

test('database atomically limits a terminal to one open shift', () => {
  assert.match(schema, /active_terminal_key\s+String\?\s+@unique/)
  assert.match(migration, /CREATE UNIQUE INDEX "pos_shifts_active_terminal_key_key"/)
  assert.match(route, /active_terminal_key: terminal\.id/)
  assert.match(route, /error\.code === 'P2002'/)
})

test('closing cannot finalize while transactions still need synchronization or review', () => {
  assert.match(route, /pending_sync/)
  assert.match(route, /synced_pending_review/)
  assert.match(route, /needs_correction/)
  assert.match(route, /status: finalized \? 'finalized' : 'locally_closed'/)
  assert.match(route, /active_terminal_key: null/)
})

test('cash reconciliation uses immutable approved POS totals', () => {
  assert.match(route, /payment_method_snapshot: 'cash'/)
  assert.match(route, /total_snapshot/)
  assert.match(route, /variance_snapshot/)
})
