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

test('database seals binary-tree financial placement identity after insertion', () => {
  const migration = readFileSync(
    'prisma/migrations/20260902146000_seal_binary_tree_placements/migration.sql',
    'utf8',
  )

  assert.match(
    migration,
    /CREATE TRIGGER "binary_tree_nodes_seal_placement"\s+BEFORE UPDATE OR DELETE ON "binary_tree_nodes"/,
  )
  assert.match(
    migration,
    /ENABLE ALWAYS TRIGGER "binary_tree_nodes_seal_placement"/,
  )
  assert.match(migration, /TG_OP IN \('DELETE', 'TRUNCATE'\)/)
  assert.match(migration, /USING ERRCODE = '55000'/)

  for (const field of [
    'id',
    'user_id',
    'parent_id',
    'position',
    'sponsor_id',
    'is_overflow',
    'created_at',
  ]) {
    assert.match(
      migration,
      new RegExp(`NEW\\."${field}" IS DISTINCT FROM OLD\\."${field}"`),
    )
  }
})

test('placement seal blocks truncate and delegates derived counts to atomic database maintenance', () => {
  const sealMigration = readFileSync(
    'prisma/migrations/20260902146000_seal_binary_tree_placements/migration.sql',
    'utf8',
  )
  const countMigration = readFileSync(
    'prisma/migrations/20260902147000_atomic_binary_tree_descendant_counts/migration.sql',
    'utf8',
  )
  const registration = readFileSync('src/app/api/city/resellers/route.ts', 'utf8')

  assert.match(
    sealMigration,
    /CREATE TRIGGER "binary_tree_nodes_block_truncate"\s+BEFORE TRUNCATE ON "binary_tree_nodes"\s+FOR EACH STATEMENT/,
  )
  assert.match(
    sealMigration,
    /ENABLE ALWAYS TRIGGER "binary_tree_nodes_block_truncate"/,
  )
  assert.match(
    countMigration,
    /CREATE TRIGGER "binary_tree_nodes_maintain_ancestor_counts"\s+AFTER INSERT ON "binary_tree_nodes"/,
  )
  assert.match(countMigration, /ORDER BY depth DESC/)
  assert.match(countMigration, /NEW\."left_count" IS DISTINCT FROM OLD\."left_count"/)
  assert.match(countMigration, /NEW\."right_count" IS DISTINCT FROM OLD\."right_count"/)
  assert.match(countMigration, /pg_trigger_depth\(\) > 1/)
  assert.match(registration, /tx\.binaryTreeNode\.create\(/)
  assert.doesNotMatch(registration, /updateAncestorCounts/)
  assert.doesNotMatch(registration, /POST-TRANSACTION[\s\S]*left_count = left_count \+ 1/)
})

test('the City/Branch registration route returns a conflict for a concurrent slot loss', () => {
  const source = readFileSync('src/app/api/city/resellers/route.ts', 'utf8')
  assert.match(source, /isBinaryTreeSlotConflict\(error\)/)
  assert.match(source, /selected binary-tree slot was taken by another registration/)
  assert.match(source, /\{ status: 409 \}/)
})

test('City/Branch registration still validates position and parent before entering the transaction', () => {
  const source = readFileSync('src/app/api/city/resellers/route.ts', 'utf8')
  assert.match(source, /!\["left", "right"\]\.includes\(actual_position\)/)
  assert.match(source, /if \(!parentNodeExists\)/)
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

test('the final City/Branch transaction enforces referrer-subtree placement before consuming the PIN', () => {
  const source = readFileSync('src/app/api/city/resellers/route.ts', 'utf8')
  const subtreeCheck = source.indexOf('await assertPlacementWithinReferrerSubtree(')
  const pinClaim = source.indexOf('await claimUnusedPin(tx, pin.id')
  assert.notEqual(subtreeCheck, -1)
  assert.notEqual(pinClaim, -1)
  assert.ok(subtreeCheck < pinClaim)
  assert.match(source, /error instanceof InvalidBinaryTreePlacementError/)
})
