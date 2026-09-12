import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('reseller order surfaces use the Door-to-Door Delivery label without changing the stored fulfillment key', () => {
  const page = readFileSync('src/app/dashboard/reseller/orders/page.tsx', 'utf8')
  const route = readFileSync('src/app/api/reseller/orders/route.ts', 'utf8')
  assert.match(page, /Door-to-Door Delivery/)
  assert.doesNotMatch(page, />🚚 Nationwide Delivery</)
  assert.match(page, /fulfillmentMethod === 'nationwide_delivery'/)
  assert.match(route, /\['partner_pickup', 'nationwide_delivery'\]/)
  assert.match(route, /Door-to-Door Delivery/)
})
