import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import {
  assertPlacementWithinReferrerSubtree,
  InvalidBinaryTreePlacementError,
  isBinaryTreeSlotConflict,
} from '../src/app/lib/binaryTreePlacement'

test('only the parent-position unique violation is treated as a slot race', () => {
  assert.equal(isBinaryTreeSlotConflict({ code: 'P2002', meta: { target: ['parent_id', 'position'] } }), true)
  assert.equal(isBinaryTreeSlotConflict({ code: 'P2002', meta: { target: ['username'] } }), false)
  assert.equal(isBinaryTreeSlotConflict({ code: 'P2003', meta: { target: ['parent_id', 'position'] } }), false)
})

test('schema and migration enforce one child per parent side', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const migration = readFileSync('prisma/migrations/20260812210000_enforce_unique_binary_tree_slots/migration.sql', 'utf8')
  assert.match(schema, /@@unique\(\[parent_id, position\]\)/)
  assert.match(migration, /CREATE UNIQUE INDEX "binary_tree_nodes_parent_id_position_key"/)
  assert.match(migration, /GROUP BY "parent_id", "position"\s+HAVING COUNT\(\*\) > 1/)
})

test('both registration routes return a conflict for a concurrent slot loss', () => {
  for (const path of [
    'src/app/api/admin/resellers/register/route.ts',
    'src/app/api/city/resellers/route.ts',
  ]) {
    const source = readFileSync(path, 'utf8')
    assert.match(source, /isBinaryTreeSlotConflict\(error\)/)
    assert.match(source, /selected binary-tree slot was taken by another registration/)
    assert.match(source, /\{ status: 409 \}/)
  }
})

test('registration still validates position and parent before entering the transaction', () => {
  for (const path of [
    'src/app/api/admin/resellers/register/route.ts',
    'src/app/api/city/resellers/route.ts',
  ]) {
    const source = readFileSync(path, 'utf8')
    assert.match(source, /!\["left", "right"\]\.includes\(actual_position\)/)
    assert.match(source, /if \(!parentNodeExists\)/)
  }
})

function placementQueryResult(isAllowed: boolean) {
  return {
    $queryRaw: async () => [{ is_allowed: isAllowed }],
  } as unknown as Prisma.TransactionClient
}

test('placement may differ from the referrer when it remains in the referrer subtree', async () => {
  await assert.doesNotReject(
    assertPlacementWithinReferrerSubtree(
      placementQueryResult(true),
      'direct-referrer-id',
      'descendant-placement-node-id',
    ),
  )
})

test('placement outside the direct referrer subtree is rejected', async () => {
  await assert.rejects(
    assertPlacementWithinReferrerSubtree(
      placementQueryResult(false),
      'direct-referrer-id',
      'unrelated-placement-node-id',
    ),
    InvalidBinaryTreePlacementError,
  )
})

test('both final registration transactions enforce referrer-subtree placement before consuming the PIN', () => {
  for (const path of [
    'src/app/api/admin/resellers/register/route.ts',
    'src/app/api/city/resellers/route.ts',
  ]) {
    const source = readFileSync(path, 'utf8')
    const subtreeCheck = source.indexOf('await assertPlacementWithinReferrerSubtree(')
    const pinClaim = source.indexOf('await claimUnusedPin(tx, pin.id)')
    assert.notEqual(subtreeCheck, -1)
    assert.notEqual(pinClaim, -1)
    assert.ok(subtreeCheck < pinClaim)
    assert.match(source, /error instanceof InvalidBinaryTreePlacementError/)
  }
})
