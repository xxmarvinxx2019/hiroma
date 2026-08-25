import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { permanentReceiptNumber } from '../src/app/lib/posOfflineQueue'

test('a POS receipt number remains deterministic from its permanent transaction UUID', () => {
  const terminal = '12345678-1234-4234-9234-123456789abc'
  const transaction = 'abcdef12-3456-4789-9234-abcdef123456'
  const first = permanentReceiptNumber(terminal, transaction)
  assert.equal(first, 'HRM-12345678-ABCDEF12345647899234ABCDEF123456')
  assert.equal(permanentReceiptNumber(terminal, transaction), first)
  assert.match(first, /^HRM-[A-F0-9]{8}-[A-F0-9]{32}$/)
})

test('different transaction UUIDs cannot print the same receipt number', () => {
  const terminal = '12345678-1234-4234-9234-123456789abc'
  assert.notEqual(
    permanentReceiptNumber(terminal, 'abcdef12-3456-4789-9234-abcdef123456'),
    permanentReceiptNumber(terminal, 'abcdef12-3456-4789-9234-bbcdef123456'),
  )
})

test('the server persists and replays the client-issued permanent receipt number', () => {
  const route = readFileSync('src/app/api/city/pos/transactions/route.ts', 'utf8')
  const migration = readFileSync('prisma/migrations/20260825150000_add_permanent_pos_receipt/migration.sql', 'utf8')
  assert.match(route, /receipt_number: receiptNumber/)
  assert.match(route, /receipt_number: transaction\.receipt_number/)
  assert.match(migration, /CREATE UNIQUE INDEX "pos_transactions_receipt_number_key"/)
})
