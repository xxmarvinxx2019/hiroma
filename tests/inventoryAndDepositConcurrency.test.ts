import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const inventoryRoute = readFileSync('src/app/api/city/inventory/audits/[id]/route.ts', 'utf8')
const posBootstrapRoute = readFileSync('src/app/api/city/pos/bootstrap/route.ts', 'utf8')
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

test('returning a POS closing creates one cashier recount notification with the manager note', () => {
  assert.match(inventoryRoute, /const returned = await tx\.posShift\.updateMany/)
  assert.match(inventoryRoute, /returned\.count === 1/)
  assert.match(inventoryRoute, /notification\.upsert/)
  assert.match(inventoryRoute, /pos-shift-recount:\$\{returnedShift\.id\}/)
  assert.match(inventoryRoute, /type: 'pos_shift_recount_required'/)
  assert.match(inventoryRoute, /title: 'Shift returned for recount'/)
  assert.match(inventoryRoute, /Note: \$\{notes\}/)
  assert.match(inventoryRoute, /action_url: '\/dashboard\/city\/pos\/history'/)
})

test('POS bootstrap backfills a missing recount notification without duplicating it', () => {
  assert.match(posBootstrapRoute, /blockingShift\?\.status === 'needs_review'/)
  assert.match(posBootstrapRoute, /existingRecountNotification/)
  assert.match(posBootstrapRoute, /notification\.upsert/)
  assert.match(posBootstrapRoute, /pos-shift-recount:\$\{blockingShift\.id\}/)
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

test('returned deposits notify participants and can only be corrected by the original submitter', () => {
  assert.match(depositRoute, /notifyDepositParticipants/)
  assert.match(depositRoute, /branch_deposit_explanation_required/)
  assert.match(branchDepositRoute, /action === 'resubmit'/)
  assert.match(branchDepositRoute, /action === 'resubmit'[\s\S]+permissions\?\.includes\('deposit_submit'\)/)
  assert.match(branchDepositRoute, /deposit\.submitted_by !== who\.id/)
  assert.match(branchDepositRoute, /status: 'needs_explanation', submitted_by: who\.id/)
  assert.match(branchDepositRoute, /cash_deposit_corrected_resubmitted/)
  assert.match(branchDepositRoute, /previous: \{ deposit_amount:/)
  assert.match(branchDepositRoute, /confirmed_by: null/)
  assert.match(branchDepositRoute, /notifyDepositConfirmers/)
})

test('deposit submission and confirmation use separate permissions', () => {
  const permissions = readFileSync('src/app/lib/staffPermissions.ts', 'utf8')
  assert.match(permissions, /key: 'deposit_submit'/)
  assert.match(permissions, /key: 'deposit_confirm'/)
  assert.match(branchDepositRoute, /permissions\?\.includes\('deposit_submit'\)/)
  assert.match(branchDepositRoute, /permissions\?\.includes\('deposit_confirm'\)/)
  assert.match(branchDepositRoute, /submitter cannot confirm the same deposit/i)
})

test('deposit-only staff cannot use the full financial report route', () => {
  const middleware = readFileSync('src/proxy.ts', 'utf8')
  const reportRoute = readFileSync('src/app/api/city/reports/route.ts', 'utf8')
  const cityLayout = readFileSync('src/app/dashboard/city/layout.tsx', 'utf8')
  const depositsPage = readFileSync('src/app/dashboard/city/deposits/page.tsx', 'utf8')

  assert.match(middleware, /dashboard\/city\/deposits[^\n]+reports\|deposit_submit\|deposit_confirm/)
  assert.match(middleware, /dashboard\/city\/reports[^\n]+return 'reports'/)
  assert.doesNotMatch(middleware, /dashboard\/city\/reports[^\n]+deposit_submit/)
  assert.match(reportRoute, /user\.is_staff && !user\.permissions\?\.includes\('reports'\)/)
  assert.match(cityLayout, /href: "\/dashboard\/city\/deposits"/)
  assert.match(depositsPage, /DepositReconciliationPanel/)
})

test('deposit periods are serialized and cannot overlap an active reconciliation', () => {
  const lock = branchDepositRoute.indexOf('pg_advisory_xact_lock')
  const overlap = branchDepositRoute.indexOf('tx.branchCashDeposit.findFirst', lock)
  const snapshot = branchDepositRoute.indexOf('calculateCollectedCash(tx', overlap)
  const create = branchDepositRoute.indexOf('tx.branchCashDeposit.create', snapshot)

  assert.ok(lock !== -1 && overlap > lock && snapshot > overlap && create > snapshot)
  assert.match(branchDepositRoute, /status: \{ not: 'rejected' \}/)
  assert.match(branchDepositRoute, /period_start: \{ lt: periodEnd \}/)
  assert.match(branchDepositRoute, /period_end: \{ gt: periodStart \}/)
  assert.match(branchDepositRoute, /DepositPeriodConflictError[^\n]+409/)
})

test('deposit decisions and correction handoffs create targeted notifications', () => {
  const notifications = readFileSync('src/app/lib/depositNotifications.ts', 'utf8')
  const panel = readFileSync('src/app/dashboard/city/reports/DepositReconciliationPanel.tsx', 'utf8')
  assert.match(notifications, /area_branch:\$\{notice\.branchId\}/)
  assert.match(notifications, /permissions: \{ array_contains: 'deposit_confirm' \}/)
  assert.match(notifications, /entity_type: 'branch_cash_deposit'/)
  assert.match(notifications, /action_url: '\/dashboard\/city\/deposits#bank-deposit-reconciliation'/)
  assert.match(panel, /row\.can_respond/)
  assert.match(panel, /Respond &amp; Resubmit/)
  assert.match(panel, /Area Manager: \{row\.review_notes\}/)
})
