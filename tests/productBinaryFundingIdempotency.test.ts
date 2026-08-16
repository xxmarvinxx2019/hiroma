import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../prisma/migrations/20260813150000_make_product_binary_funding_idempotent/migration.sql', import.meta.url),
  'utf8',
)

test('funding allocation serializes and rechecks the exact commission', () => {
  const lock = migration.indexOf('pg_advisory_xact_lock(hashtextextended(target_commission_id, 0))')
  const recheck = migration.indexOf('WHERE commission_id = target_commission_id', lock)
  const firstMutation = migration.indexOf('UPDATE product_binary_funding_lots')
  assert.ok(lock >= 0 && lock < recheck && recheck < firstMutation)
})

test('funding allocator waits for FIFO lots instead of treating lock contention as unfunded', () => {
  assert.match(migration, /ORDER BY allocated_at, id\s+FOR UPDATE\s+LIMIT 1/)
  assert.doesNotMatch(migration, /SKIP LOCKED/)
})

test('existing funded and unfunded calculation semantics remain intact', () => {
  assert.match(migration, /remaining := target_amount/)
  assert.match(migration, /used := LEAST\(remaining, lot\.remaining_amount\)/)
  assert.match(migration, /remaining_amount = remaining_amount - used/)
  assert.match(migration, /lot\.id, target_commission_id, used, false, at_time/)
  assert.match(migration, /NULL, target_commission_id, remaining, true, at_time/)
})
