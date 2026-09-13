import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const resellerOrders = fs.readFileSync('src/app/dashboard/reseller/orders/page.tsx', 'utf8')
const cityModal = fs.readFileSync('src/app/dashboard/city/orders/CityOrderDetailsModal.tsx', 'utf8')
const resellerLayout = fs.readFileSync('src/app/dashboard/reseller/layout.tsx', 'utf8')
const cityLayout = fs.readFileSync('src/app/dashboard/city/layout.tsx', 'utf8')
const conversation = fs.readFileSync('src/app/components/orders/OrderConversation.tsx', 'utf8')

test('order conversation lives only inside each participant order detail', () => {
  assert.match(resellerOrders, /<OrderConversation orderId=\{selectedOrder\.id\}/)
  assert.match(cityModal, /<OrderConversation orderId=\{order\.id\}/)
  assert.doesNotMatch(resellerLayout, /OrderChatInbox/)
  assert.doesNotMatch(cityLayout, /OrderChatInbox/)
})

test('reseller checkout supports an initial City or Branch instruction', () => {
  assert.match(resellerOrders, /Message to City\/Branch \(optional\)/)
})

test('conversation performs no background interval polling', () => {
  assert.doesNotMatch(conversation, /setInterval/)
})
