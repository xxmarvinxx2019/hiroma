import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

test('critical City and reseller requests notify every active Admin account', () => {
  const helper = read('src/app/lib/adminRequestNotifications.ts')
  assert.match(helper, /role: 'admin', status: 'active'/)
  assert.match(helper, /notification\.createMany/)

  const cases = [
    ['src/app/api/pin-requests/route.ts', /type: 'pin_request_created'/],
    ['src/app/api/pin-requests/[id]/payment/route.ts', /type: 'pin_request_payment_submitted'/],
    ['src/app/api/reseller/wallet/route.ts', /type: 'payout_requested'/],
    ['src/app/api/payment-methods/route.ts', /type: 'payment_method_submitted'/],
  ] as const
  for (const [path, pattern] of cases) {
    const source = read(path)
    assert.match(source, /notifyActiveAdmins/)
    assert.match(source, pattern)
  }
})

test('Admin notifications link only to protected Admin review screens', () => {
  const sources = [
    read('src/app/api/pin-requests/route.ts'),
    read('src/app/api/pin-requests/[id]/payment/route.ts'),
    read('src/app/api/reseller/wallet/route.ts'),
    read('src/app/api/payment-methods/route.ts'),
  ].join('\n')
  assert.doesNotMatch(sources, /account_number.*message:/)
  assert.match(sources, /actionUrl: '\/dashboard\/admin\/pin-requests'/)
  assert.match(sources, /actionUrl: '\/dashboard\/admin\/payouts'/)
  assert.match(sources, /actionUrl: '\/dashboard\/admin\/payment-methods'/)
})
