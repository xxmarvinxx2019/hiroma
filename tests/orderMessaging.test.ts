import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
const api = fs.readFileSync('src/app/api/orders/[id]/messages/route.ts', 'utf8')
const migration = fs.readFileSync('prisma/migrations/20260912100000_add_order_messaging/migration.sql', 'utf8')
const reseller = fs.readFileSync('src/app/dashboard/reseller/orders/page.tsx', 'utf8')
const city = fs.readFileSync('src/app/dashboard/city/orders/CityOrderDetailsModal.tsx', 'utf8')
test('order messages are limited to reseller and assigned City or Branch participants', () => {
  assert.match(api, /buyer_id: accountId/); assert.match(api, /seller_id: accountId/)
  assert.match(api, /order\.buyer\.role === 'reseller'/); assert.match(api, /\['city', 'branch'\]/)
  assert.match(migration, /Sender is not an order participant/)
})
test('completed order conversations are server-locked but retain their history', () => {
  assert.match(api, /OPEN_STATUSES/); assert.match(migration, /status" IN \('delivered', 'cancelled'\)/)
  assert.match(migration, /ON DELETE CASCADE/)
  assert.match(migration, /Order message history is immutable/)
})
test('both participant order modals expose the same scoped conversation', () => {
  assert.match(reseller, /<OrderConversation orderId=\{selectedOrder\.id\}/)
  assert.match(city, /<OrderConversation orderId=\{order\.id\}/)
})
