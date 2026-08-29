import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
const migration = fs.readFileSync('prisma/migrations/20260825123000_guard_single_open_pos_shift/migration.sql', 'utf8')
const route = fs.readFileSync('src/app/api/city/pos/shifts/route.ts', 'utf8')
const posPage = fs.readFileSync('src/app/dashboard/city/pos/page.tsx', 'utf8')
const cityLayout = fs.readFileSync('src/app/dashboard/city/layout.tsx', 'utf8')
const bootstrap = fs.readFileSync('src/app/api/city/pos/bootstrap/route.ts', 'utf8')
const historyPage = fs.readFileSync('src/app/dashboard/city/pos/history/page.tsx', 'utf8')

test('database atomically limits a terminal to one open shift', () => {
  assert.match(schema, /active_terminal_key\s+String\?\s+@unique/)
  assert.match(migration, /CREATE UNIQUE INDEX "pos_shifts_active_terminal_key_key"/)
  assert.match(route, /active_terminal_key: terminal\.id/)
  assert.match(route, /error\.code === ["']P2002["']/)
})

test('closing cannot finalize while transactions still need synchronization or review', () => {
  assert.match(route, /pending_sync/)
  assert.match(route, /synced_pending_review/)
  assert.match(route, /needs_correction/)
  assert.match(route, /if \(pending > 0\)/)
  assert.match(route, /SHIFT_SYNC_INCOMPLETE/)
  assert.doesNotMatch(route, /status: finalized \? 'finalized' : 'locally_closed'/)
  assert.match(route, /active_terminal_key: null/)
})

test('cash reconciliation uses immutable approved POS totals', () => {
  assert.match(route, /payment_method_snapshot: ["']cash["']/)
  assert.match(route, /total_snapshot/)
  assert.match(route, /variance_snapshot/)
})

test('open cashier shift moves the close action to the top bar', () => {
  assert.match(posPage, /!data\?\.open_shift\s*&&\s*\(\s*<section/)
  assert.match(posPage, /hiroma:pos-shift-state/)
  assert.match(posPage, /hiroma:open-close-shift/)
  assert.match(posPage, /PosCloseShiftModal/)
  assert.doesNotMatch(posPage, /close_shift=1/)
  assert.match(cityLayout, /user\?\.is_staff\s*&&\s*posShiftOpen/)
  assert.match(cityLayout, /hiroma:open-close-shift/)
})

test('cashier navigation prioritizes Sales without renaming the owner menu', () => {
  assert.match(cityLayout, /cashierNavPriority/)
  assert.match(cityLayout, /["']\/dashboard\/city\/pos["']:\s*1/)
  assert.match(cityLayout, /["']\/dashboard\/city\/pos\/registrations["']:\s*2/)
  assert.match(cityLayout, /["']\/dashboard\/city\/inventory["']:\s*3/)
  assert.match(cityLayout, /item\.href === ["']\/dashboard\/city\/pos["']/)
  assert.match(cityLayout, /label: ["']Sales["']/)
  assert.match(cityLayout, /user\?\.is_staff\s*\?\s*\(cashierNavPriority/)
})

test('concurrent shift closes are serialized and return a safe retry response', () => {
  assert.match(route, /TransactionIsolationLevel\.Serializable/)
  assert.match(route, /timeout:\s*20_000/)
  assert.match(route, /error\.code === ["']P2034["']/)
  assert.match(route, /SHIFT_CLOSE_CONFLICT/)
})

test('returned shifts block a new shift and guide the cashier through recount', () => {
  assert.match(route, /status: \{ in: \["locally_closed", "needs_review"\] \}/)
  assert.match(route, /SHIFT_REVIEW_PENDING/)
  assert.match(bootstrap, /blocking_shift: blockingShift/)
  assert.match(posPage, /Shift returned for recount/)
  assert.match(posPage, /Review & Recount/)
  assert.match(historyPage, /Manager note:/)
  assert.match(historyPage, /Recount & Resubmit/)
})
