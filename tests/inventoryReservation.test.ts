import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validateStockItems } from '../src/app/lib/inventoryReservation'

test('stock reservation accepts only positive whole-number quantities', () => {
  assert.equal(validateStockItems([{ product_id: 'product-a', quantity: 2 }]), true)
  assert.equal(validateStockItems([{ product_id: 'product-a', quantity: 0 }]), false)
  assert.equal(validateStockItems([{ product_id: 'product-a', quantity: -1 }]), false)
  assert.equal(validateStockItems([{ product_id: 'product-a', quantity: 1.5 }]), false)
})

test('reservation and walk-in consumption use one atomic available-stock predicate', () => {
  const source = readFileSync('src/app/lib/inventoryReservation.ts', 'utf8')
  const atomicAvailabilityChecks = source.match(/\("quantity" - "reserved_quantity"\) >= \$\{item\.quantity\}/g) || []
  assert.equal(atomicAvailabilityChecks.length, 2)
  assert.match(source, /SET "reserved_quantity" = "reserved_quantity" \+ \$\{item\.quantity\}/)
})

test('delivery atomically deducts physical stock and releases its reservation', () => {
  const source = readFileSync('src/app/lib/inventoryReservation.ts', 'utf8')
  assert.match(source, /SET "quantity" = "quantity" - \$\{item\.quantity\},\s+"reserved_quantity" = "reserved_quantity" - \$\{item\.quantity\}/)
  assert.match(source, /AND "reserved_quantity" >= \$\{item\.quantity\}/)
})

test('database constraint prevents negative and over-reserved inventory', () => {
  const migration = readFileSync('prisma/migrations/20260812190000_add_inventory_reservations/migration.sql', 'utf8')
  assert.match(migration, /"quantity" >= 0/)
  assert.match(migration, /"reserved_quantity" >= 0/)
  assert.match(migration, /"reserved_quantity" <= "quantity"/)
})

test('admin registration consumes package stock atomically inside its transaction', () => {
  const route = readFileSync('src/app/api/admin/resellers/register/route.ts', 'utf8')
  const transaction = route.indexOf('const registration = await prisma.$transaction')
  const consumption = route.indexOf('await consumeAvailableStock(', transaction)
  assert.ok(transaction !== -1 && consumption > transaction)
  assert.doesNotMatch(route.slice(transaction), /tx\.inventory\.update\(/)
  assert.match(route, /error instanceof InsufficientStockError/)
})
