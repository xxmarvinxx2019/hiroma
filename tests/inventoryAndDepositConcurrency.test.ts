import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const inventoryRoute = readFileSync('src/app/api/city/inventory/audits/[id]/route.ts', 'utf8')
const depositRoute = readFileSync('src/app/api/area-manager/deposits/route.ts', 'utf8')
const branchDepositRoute = readFileSync('src/app/api/city/deposits/route.ts', 'utf8')

test('inventory reconciliation atomically requires the frozen expected quantity', () => {
  assert.match(inventoryRoute, /inventoryAuditSession\.updateMany/)
  assert.match(inventoryRoute, /status: 'submitted'/)
  assert.match(inventoryRoute, /tx\.inventory\.updateMany/)
  assert.match(inventoryRoute, /quantity: item\.expected_quantity/)
  assert.match(inventoryRoute, /reconciled\.count !== 1/)
  assert.match(inventoryRoute, /InventoryAuditConflictError \? 409/)
  assert.match(inventoryRoute, /status: 'rejected'/)
})

test('deposit review claims an allowed source status before writing its audit event', () => {
  const claim = depositRoute.indexOf('tx.branchCashDeposit.updateMany')
  const event = depositRoute.indexOf('tx.inventoryAuditEvent.create', claim)
  assert.ok(claim !== -1 && event > claim)
  assert.match(depositRoute, /status: \{ in: allowedStatuses \}/)
  assert.match(depositRoute, /claimed\.count !== 1/)
  assert.match(depositRoute, /DepositReviewConflictError \? 409/)
})

test('branch deposit confirmation can be claimed only once', () => {
  const claim = branchDepositRoute.indexOf('tx.branchCashDeposit.updateMany')
  const event = branchDepositRoute.indexOf('tx.inventoryAuditEvent.create', claim)
  assert.ok(claim !== -1 && event > claim)
  assert.match(branchDepositRoute, /branch_id: user\.id, status: 'submitted'/)
  assert.match(branchDepositRoute, /claimed\.count !== 1/)
  assert.match(branchDepositRoute, /DepositConfirmationConflictError \? 409/)
})
