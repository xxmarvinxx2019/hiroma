import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isBinaryTreeSlotConflict } from '../src/app/lib/binaryTreePlacement'

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
