import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path: string) => readFileSync(path, "utf8")

test("cash movements use a separate constrained audit ledger", () => {
  const schema = read("prisma/schema.prisma")
  const migration = read("prisma/migrations/20260828013000_add_pos_cash_movements/migration.sql")
  assert.match(schema, /model PosCashMovement[\s\S]*movement_type[\s\S]*reviewed_by_id/)
  assert.match(schema, /model PosCashMovement[\s\S]*client_request_id\s+String\s+@unique\s+@db\.Uuid/)
  assert.match(migration, /client_request_id" UUID NOT NULL/)
  assert.match(migration, /UNIQUE INDEX "pos_cash_movements_client_request_id_key"/)
  assert.match(migration, /CHECK \("movement_type" IN \('paid_in', 'paid_out'\)\)/)
  assert.match(migration, /CHECK \("amount" > 0\)/)
})

test("paid out requires independent approval while paid in is applied", () => {
  const route = read("src/app/api/city/pos/cash-movements/route.ts")
  assert.match(route, /status: type === 'paid_in' \? 'applied' : 'pending'/)
  assert.match(route, /movement\.requested_by_id === actorId[\s\S]*POS_SELF_APPROVAL/)
  assert.match(route, /createRequiredAuditLog\(tx,/)
  assert.match(route, /notes\.length < 5/)
  assert.match(route, /findUnique\(\{ where: \{ client_request_id: clientRequestId \}/)
  assert.match(route, /error\.code !== 'P2002'/)
  assert.match(route, /replayed: result\.replayed/)
})

test("shift reconciliation includes only applied or approved movement totals", () => {
  const shifts = read("src/app/api/city/pos/shifts/route.ts")
  assert.match(shifts, /pendingPaidOut[\s\S]*SHIFT_CASH_MOVEMENT_PENDING/)
  assert.match(shifts, /calculateShiftCashSales\(tx, shift\.id\)/)
  assert.match(shifts, /opening_cash\)\s*\+\s*cashSales\.total[\s\S]*\+\s*paidIn\s*-\s*paidOut/)
})

test("cashier UI keeps expected drawer hidden and provides cash management", () => {
  const page = read("src/app/dashboard/city/pos/history/page.tsx")
  assert.match(page, /Expected drawer cash remains hidden until blind count/)
  assert.match(page, /Paid Out is only a request; do not remove cash until an independent manager approves it/)
  assert.match(page, /Cash Management/)
  assert.match(page, /crypto\.randomUUID\(\)/)
  assert.match(page, /client_request_id: clientRequestId/)
  assert.match(page, /PosCloseShiftModal/)
  assert.match(page, /setCloseShiftModal\(true\)/)
  assert.doesNotMatch(page, /close_shift=1/)
  assert.match(page, /Starting cash[\s\S]*Cash payments[\s\S]*Cash refunds[\s\S]*Paid in[\s\S]*Paid out/)
  assert.doesNotMatch(page, /How payments were recorded/)
  assert.doesNotMatch(page, /Receipt history/)
  assert.match(page, /Non-cash payments/)
  assert.match(page, /Pending payments are not included in the approved total/)
  assert.match(page, /These amounts never form part of the physical cash drawer/)
})
