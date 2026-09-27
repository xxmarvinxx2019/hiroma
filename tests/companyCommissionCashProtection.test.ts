import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const route = readFileSync('src/app/api/admin/commission-testing/binary-commission/route.ts', 'utf8')
const page = readFileSync('src/app/dashboard/admin/commission-testing/binary-commission/page.tsx', 'utf8')

test('admin cash protection totals every commission source and payout stage', () => {
  assert.match(route, /direct_referral_reserve_lots/)
  assert.match(route, /binary_payable_lots/)
  assert.match(route, /product_binary_payable_lots/)
  assert.match(route, /pending_payout_amount/)
  assert.match(route, /approved_for_release/)
  assert.match(route, /minimum_protected_cash/)
  assert.match(page, /Company Commission Liability and Cash Protection/)
  assert.match(page, /Actual bank connection/)
})

test('admin exposes the selected-period Recruitment Binary payout ratio and warnings', () => {
  assert.match(route, /binaryPayoutRatio >= 70/)
  assert.match(route, /binaryPayoutRatio >= 50/)
  assert.match(route, /company_pin_allocation - managementPlan\.direct_payable_generated/)
  assert.match(page, /Selected-period Recruitment Binary payout ratio/)
  assert.match(page, /Green below 50% · Warning from 50% · Critical from 70%/)
})
