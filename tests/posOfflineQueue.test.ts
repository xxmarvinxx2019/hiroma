import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  filterQueuedRecordsForScope,
  permanentReceiptNumber,
  posOfflineScopeId,
  queuedRecordBelongsToScope,
} from '../src/app/lib/posOfflineQueue'

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

test('offline records are visible only to their immutable owner and terminal scope', () => {
  const ownerA = { owner_id: 'owner-a', terminal_id: 'terminal-1' }
  const ownerB = { owner_id: 'owner-b', terminal_id: 'terminal-1' }
  const terminalTwo = { owner_id: 'owner-a', terminal_id: 'terminal-2' }
  const records = [
    { id: 'a1', offline_scope_id: posOfflineScopeId(ownerA) },
    { id: 'b1', offline_scope_id: posOfflineScopeId(ownerB) },
    { id: 'a2', offline_scope_id: posOfflineScopeId(terminalTwo) },
    { id: 'legacy' },
  ]

  assert.deepEqual(filterQueuedRecordsForScope(records, ownerA).map((row) => row.id), ['a1'])
  assert.equal(queuedRecordBelongsToScope(records[0], ownerA), true)
  assert.equal(queuedRecordBelongsToScope(records[0], ownerB), false)
  assert.equal(queuedRecordBelongsToScope(records[3], ownerA), false)
})
