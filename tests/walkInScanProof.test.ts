import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import {
  consumeWalkInScanProof,
  InvalidWalkInScanProofError,
} from '../src/app/lib/walkInScanProof'

function proofStore(matches: (where: Record<string, unknown>) => boolean) {
  let consumed = false
  return {
    tx: {
      walkInMemberScanProof: {
        updateMany: async ({ where }: { where: Record<string, unknown> }) => {
          if (consumed || !matches(where)) return { count: 0 }
          consumed = true
          return { count: 1 }
        },
      },
    } as unknown as Prisma.TransactionClient,
  }
}

test('valid proof is consumed once and replay is rejected', async () => {
  const store = proofStore((where) => where.distributor_id === 'city-a' && where.reseller_id === 'reseller-a')
  await consumeWalkInScanProof(store.tx, 'valid-token', 'city-a', 'reseller-a')
  await assert.rejects(
    consumeWalkInScanProof(store.tx, 'valid-token', 'city-a', 'reseller-a'),
    InvalidWalkInScanProofError,
  )
})

test('proof bound to another reseller or distributor is rejected', async () => {
  const store = proofStore((where) => where.distributor_id === 'city-a' && where.reseller_id === 'reseller-a')
  await assert.rejects(
    consumeWalkInScanProof(store.tx, 'valid-token', 'city-b', 'reseller-a'),
    InvalidWalkInScanProofError,
  )
  await assert.rejects(
    consumeWalkInScanProof(store.tx, 'valid-token', 'city-a', 'reseller-b'),
    InvalidWalkInScanProofError,
  )
})

test('member sale consumes proof before stock and order creation while non-member flow remains available', () => {
  const route = readFileSync('src/app/api/city/orders/reseller-orders/route.ts', 'utf8')
  const transaction = route.indexOf('const order = await prisma.$transaction')
  const proof = route.indexOf('await consumeWalkInScanProof(', transaction)
  const stock = route.indexOf('await consumeAvailableStock(', transaction)
  const order = route.indexOf('const newOrder = await tx.order.create(', transaction)
  assert.ok(transaction !== -1 && proof > transaction && stock > proof && order > stock)
  assert.match(route, /if \(!isNonMemberSale\)/)
  assert.match(route, /scan_proof: proof\.token/)
})

test('schema and migration enforce hashed, expiring, single-use proofs', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const migration = readFileSync('prisma/migrations/20260813120000_add_walk_in_member_scan_proofs/migration.sql', 'utf8')
  assert.match(schema, /model WalkInMemberScanProof/)
  assert.match(schema, /token_hash\s+String\s+@unique/)
  assert.match(migration, /FOREIGN KEY \("reseller_id"\)/)
  assert.match(migration, /FOREIGN KEY \("distributor_id"\)/)
  assert.match(migration, /walk_in_member_scan_proofs_token_hash_key/)
})

test('city UI obtains a short-lived proof for QR, Member ID, and reseller search selection', () => {
  const page = readFileSync('src/app/dashboard/city/orders/page.tsx', 'utf8')
  assert.match(page, /const \[scanProof, setScanProof\] = useState\(''\)/)
  assert.match(page, /scan_proof: selectedResellerId \? scanProof : null/)
  assert.match(page, /setScanProof\(data\.scan_proof\)/)
  assert.match(page, /void identifyScannedMember\(r\.member_id\)/)
})
