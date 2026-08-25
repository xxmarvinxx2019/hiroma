import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { permanentReceiptNumber } from '../src/app/lib/posOfflineQueue'

test('a printed POS receipt uses the standardized readable format', () => {
  const date = new Date(2026, 7, 25, 11, 30)
  const first = permanentReceiptNumber('SOG', '1F879AA', date, 123)
  assert.equal(first, 'HRM-SOG-1F879AA-260825-000123')
  assert.equal(permanentReceiptNumber('SOG', '1F879AA', date, 123), first)
  assert.match(first, /^HRM-[A-Z0-9]{3}-[A-F0-9]{7}-[0-9]{6}-[0-9]{6}$/)
})

test('different reserved sequences cannot print the same receipt number', () => {
  const date = new Date(2026, 7, 25)
  assert.notEqual(permanentReceiptNumber('SOG', '1F879AA', date, 123), permanentReceiptNumber('SOG', '1F879AA', date, 124))
})

test('the server persists and replays the client-issued permanent receipt number', () => {
  const route = readFileSync('src/app/api/city/pos/transactions/route.ts', 'utf8')
  const migration = readFileSync('prisma/migrations/20260825150000_add_permanent_pos_receipt/migration.sql', 'utf8')
  const reservationMigration = readFileSync('prisma/migrations/20260825160000_add_pos_receipt_sequence_reservation/migration.sql', 'utf8')
  assert.match(route, /receipt_number: receiptNumber/)
  assert.match(route, /receipt_number: transaction\.receipt_number/)
  assert.match(route, /POS_RECEIPT_UNRESERVED/)
  assert.match(migration, /CREATE UNIQUE INDEX "pos_transactions_receipt_number_key"/)
  assert.match(reservationMigration, /pos_transactions_terminal_id_receipt_sequence_key/)
})
