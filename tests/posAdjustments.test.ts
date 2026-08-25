import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

test('completed POS receipts use an immutable adjustment request', () => {
  const schema = read('prisma/schema.prisma')
  const route = read('src/app/api/city/pos/adjustments/route.ts')
  assert.match(schema, /model PosAdjustmentRequest/)
  assert.match(schema, /pos_transaction_id\s+String\s+@unique/)
  assert.match(route, /status: 'finalized', adjustment_request: null/)
  assert.match(route, /Only your own finalized POS receipt/)
})

test('POS adjustment approval enforces maker approver and restores stock once', () => {
  const route = read('src/app/api/city/pos/adjustments/route.ts')
  assert.match(route, /request\.requested_by_id === actorId/)
  assert.match(route, /status: 'pending'/)
  assert.match(route, /status: 'finalized'/)
  assert.match(route, /quantity: \{ increment: item\.quantity \}/)
  assert.match(route, /inventoryAuditEvent\.create/)
  assert.match(route, /payment_status: request\.request_type === 'void' \? 'voided' : 'refunded'/)
})

test('member POS reversals remain locked until commission clawback exists', () => {
  const route = read('src/app/api/city/pos/adjustments/route.ts')
  assert.match(route, /transaction\.transaction_type !== 'non_member_sale'/)
  assert.match(route, /PU, commissions, and wallet credits require a separate verified reversal workflow/)
  assert.match(route, /POS_MEMBER_REVERSAL_LOCKED/)
})

test('POS adjustment routes accept cashier or approver permission', () => {
  const middleware = read('src/middleware.ts')
  const layout = read('src/app/dashboard/city/layout.tsx')
  assert.match(middleware, /pos\/adjustments[\s\S]*return 'pos\|pos_approve'/)
  assert.match(layout, /Void & Refunds/)
  assert.match(layout, /'\/dashboard\/city\/pos\/adjustments': 'pos\|pos_approve'/)
})
